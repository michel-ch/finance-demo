// Per-profile data store. Local-first, persists to localStorage.
// Loads mock data from data.js on first profile launch so the app feels alive.
//
// Schema follows master-spec §9: accounts, cards, transactions, categories,
// recurring, goals, budgets, holdings, dca plans, import staging, etc.
//
// API: window.FCStore.{ get, set, list, create, update, remove, snapshot, restore, seedIfEmpty }

(function () {
  function key(profileId, table) { return 'fc.data.' + profileId + '.' + table; }

  function load(k, def) {
    try { return JSON.parse(localStorage.getItem(k)) || def; } catch (e) { return def; }
  }
  function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  function uid(prefix) { return (prefix || 'x_') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }

  function round2(n) { return Math.round(n * 100) / 100; }

  function addMonths(d, n) {
    // Roll forward n months without the JS overflow that turns Jan 31 + 1mo into
    // March 3; clamp to the last valid day of the target month instead.
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    var lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
  }

  function ymdLocal(d) {
    // Format using local calendar components. toISOString() would shift the date by
    // the machine's UTC offset and can land an event on the wrong projection day.
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function parseLocalDate(s) {
    // Parse 'YYYY-MM-DD' as local midnight (new Date('YYYY-MM-DD') is UTC midnight,
    // which mismatches the local-midnight `today` used elsewhere).
    return new Date(String(s).slice(0, 10) + 'T00:00:00');
  }

  function affectsCache(table) {
    return table === 'accounts' || table === 'transactions'
        || table === 'cards' || table === 'goals' || table === 'budgets';
  }

  function txAccountAmount(t) {
    if (typeof t.amountOriginal === 'number') return t.amountOriginal;
    if (typeof t.amount === 'number') return t.amount;
    return 0;
  }

  function txMatchesAccount(t, a) {
    if (t.accountId && t.accountId === a.id) return true;
    if (!t.accountId && t.account && a.name && t.account === a.name) return true;
    return false;
  }

  function txMatchesCard(t, c) {
    if (t.cardId && t.cardId === c.id) return true;
    if (!t.cardId && t.card && c.name) {
      var display = c.last4 ? (c.name + ' •• ' + c.last4) : c.name;
      if (t.card === display || t.card === c.name) return true;
    }
    return false;
  }

  var TABLES = [
    'accounts', 'cards', 'transactions', 'categories', 'tags',
    'recurring', 'goals', 'budgets', 'holdings', 'dcaPlans',
    'importStaging', 'importTemplates', 'priceCache', 'fxCache',
  ];

  var FCStore = {
    profileId: function () {
      var p = window.FCAuth && window.FCAuth.currentProfile();
      return p ? p.id : null;
    },

    list: function (table) {
      var pid = this.profileId();
      if (!pid) return [];
      return load(key(pid, table), []);
    },

    set: function (table, rows) {
      var pid = this.profileId();
      if (!pid) return;
      save(key(pid, table), rows);
      if (affectsCache(table)) this.recompute();
    },

    get: function (table, id) {
      return this.list(table).find(function (r) { return r.id === id; }) || null;
    },

    create: function (table, row) {
      var rows = this.list(table);
      if (!row.id) row.id = uid(table.slice(0, 1) + '_');
      row.createdAt = row.createdAt || new Date().toISOString();
      rows.unshift(row);
      save(key(this.profileId(), table), rows);
      if (affectsCache(table)) this.recompute(table, row.id);
      return row;
    },

    update: function (table, id, patch) {
      var rows = this.list(table);
      var i = rows.findIndex(function (r) { return r.id === id; });
      if (i < 0) return null;
      rows[i] = Object.assign({}, rows[i], patch, { updatedAt: new Date().toISOString() });
      save(key(this.profileId(), table), rows);
      if (affectsCache(table)) this.recompute(table, id);
      return rows[i];
    },

    remove: function (table, id) {
      var rows = this.list(table).filter(function (r) { return r.id !== id; });
      save(key(this.profileId(), table), rows);
      if (affectsCache(table)) this.recompute(table, id);
    },

    /**
     * Re-derive every cached money value from the source-of-truth tables.
     * Called automatically after any mutation on accounts / transactions /
     * cards / goals / budgets, and on restore + seed. Idempotent.
     *
     * Scope hint (optional): pass (changedTable, changedId) to mark a self-mutation
     * — e.g., the user clicked Reset on Budget X. Other rows in the same table are
     * preserved as-is, so the user only sees the row they touched change. Tx mutations
     * (or any call without scope) cascade across all dependent rows as before.
     *
     * Derives:
     *   accounts[i].balance      = openingBalance + Σ(t.amountOriginal where t∈this account)
     *   goals[i].current         = depends on goal.type + linkedAccountId/CategoryId
     *   budgets[i].spent         = Σ |t.amountOriginal| for expenses in b.month + b.categoryId
     *   cards[i].cycleSpend      = Σ |t.amountOriginal| for current-month expenses on this card
     *
     * Legacy accounts whose openingBalance was set to the displayed balance (the demo
     * seed used to do this) are detected on first run via the missing _recomputed flag
     * and backfilled so the visible balance is preserved.
     */
    recompute: function (changedTable, changedId) {
      var pid = this.profileId();
      if (!pid) return;
      var accounts = this.list('accounts');
      var txs = this.list('transactions');
      var cards = this.list('cards');
      var goals = this.list('goals');
      var budgets = this.list('budgets');
      var thisMonth = new Date().toISOString().slice(0, 7);

      // True iff the change came from this table on a different row — in that
      // case we leave the row alone so the user only sees what they touched move.
      function preserves(thisTable, thisId) {
        return changedTable === thisTable && changedId && thisId !== changedId;
      }

      // 1) Account balance — uses amountOriginal so the math stays in the
      // account's currency; cross-currency aggregation lives in the screens.
      var newAccounts = accounts.map(function (a) {
        if (preserves('accounts', a.id)) return a;
        var sum = 0;
        txs.forEach(function (t) { if (txMatchesAccount(t, a)) sum += txAccountAmount(t); });
        var opening;
        if (a._recomputed && a.openingBalance != null) {
          opening = a.openingBalance;
        } else {
          // Legacy / seeded accounts: derive opening so visible balance is preserved.
          opening = (a.balance != null ? a.balance : 0) - sum;
        }
        return Object.assign({}, a, {
          balance: round2(opening + sum),
          openingBalance: round2(opening),
          _recomputed: true,
        });
      });
      save(key(pid, 'accounts'), newAccounts);
      var byId = {};
      newAccounts.forEach(function (a) { byId[a.id] = a; });

      // 2) Goal progress.
      var newGoals = goals.map(function (g) {
        if (preserves('goals', g.id)) return g;
        if (g.type === 'save' && g.linkedAccountId && byId[g.linkedAccountId]) {
          return Object.assign({}, g, { current: round2(Math.max(0, byId[g.linkedAccountId].balance || 0)) });
        }
        if (g.type === 'pay-off' && g.linkedAccountId && byId[g.linkedAccountId]) {
          var owed = Math.max(0, -(byId[g.linkedAccountId].balance || 0));
          return Object.assign({}, g, { current: round2(Math.max(0, (g.target || 0) - owed)) });
        }
        if (g.type === 'cap-spend' && g.linkedCategoryId) {
          var capSpent = 0;
          txs.forEach(function (t) {
            if (t.transfer) return;
            if (t.categoryId !== g.linkedCategoryId) return;
            if (!t.date || t.date.slice(0, 7) !== thisMonth) return;
            var v = txAccountAmount(t);
            if (v < 0) capSpent += -v;
          });
          return Object.assign({}, g, { current: round2(capSpent) });
        }
        if (g.type === 'net-worth') {
          var nw = newAccounts.reduce(function (s, a) { return s + (a.balance || 0); }, 0);
          return Object.assign({}, g, { current: round2(nw) });
        }
        return g;
      });
      save(key(pid, 'goals'), newGoals);

      // 3) Budget consumption — raw is the txs sum, displayed is raw - baseline.
      // The baseline lets the user click "Reset" without deleting any transactions:
      // a row with `_resetSpent: true` has its baseline snapped to the current raw,
      // which makes the progress bar jump to 0 and the sentinel is cleared.
      var newBudgets = budgets.map(function (b) {
        if (preserves('budgets', b.id)) return b;
        if (!b.categoryId || !b.month) return b;
        var month = String(b.month).slice(0, 7);
        var rawSpent = 0;
        txs.forEach(function (t) {
          if (t.transfer) return;
          if (t.categoryId !== b.categoryId) return;
          if (!t.date || t.date.slice(0, 7) !== month) return;
          var v = txAccountAmount(t);
          if (v < 0) rawSpent += -v;
        });
        var baseline = b._resetSpent ? rawSpent : (b.spentBaseline || 0);
        var displayed = Math.max(0, rawSpent - baseline);
        return Object.assign({}, b, {
          spent: round2(displayed),
          spentBaseline: round2(baseline),
          _resetSpent: false,
        });
      });
      save(key(pid, 'budgets'), newBudgets);

      // 4) Card cycle spend (current calendar month, expenses only).
      var newCards = cards.map(function (c) {
        if (preserves('cards', c.id)) return c;
        var cSpent = 0;
        txs.forEach(function (t) {
          if (t.transfer) return;
          if (!txMatchesCard(t, c)) return;
          if (!t.date || t.date.slice(0, 7) !== thisMonth) return;
          var v = txAccountAmount(t);
          if (v < 0) cSpent += -v;
        });
        return Object.assign({}, c, { cycleSpend: round2(cSpent) });
      });
      save(key(pid, 'cards'), newCards);
    },

    /** Snapshot all tables for this profile — used by Backup → Export. */
    snapshot: function () {
      var pid = this.profileId();
      if (!pid) return null;
      var blob = { profileId: pid, exportedAt: new Date().toISOString(), tables: {} };
      TABLES.forEach(function (t) { blob.tables[t] = load(key(pid, t), []); });
      blob.profile = window.FCAuth.currentProfile();
      return blob;
    },

    restore: function (blob) {
      if (!blob || !blob.tables) throw new Error('Invalid backup file.');
      var pid = this.profileId();
      if (!pid) throw new Error('No active profile.');
      Object.keys(blob.tables).forEach(function (t) {
        save(key(pid, t), blob.tables[t]);
      });
      this.recompute();
    },

    /**
     * Seed only the 12 default categories so the user has something to pick from when
     * adding their first transaction. Does NOT seed accounts, transactions, goals,
     * budgets, recurring, or holdings — new users start with a clean slate.
     */
    seedDefaultCategoriesIfEmpty: function () {
      var pid = this.profileId();
      if (!pid) return;
      if (this.list('categories').length > 0) return;
      this.set('categories', defaultCategories());
    },

    /**
     * Seed full demo data (accounts, transactions, goals, budgets, recurring, holdings)
     * from window.FCData. Used by the demo build only; the production build calls
     * seedDefaultCategoriesIfEmpty above instead.
     */
    seedDemoData: function () {
      var pid = this.profileId();
      if (!pid) return;
      if (this.list('accounts').length > 0) return;
      var data = window.FCData;
      if (!data) return;

      var nowIso = new Date().toISOString();
      var cats = defaultCategories();
      this.set('categories', cats);

      this.set('accounts', (data.accounts || []).map(function (a) {
        return Object.assign({}, a, { archived: false, openingBalance: a.balance, openingDate: nowIso });
      }));

      this.set('transactions', (data.transactions || []).map(function (t) {
        var catId = (cats.find(function (c) { return c.name.toLowerCase() === (t.category || '').toLowerCase(); }) || {}).id;
        return Object.assign({}, t, {
          amountOriginal: t.amount,
          currencyOriginal: t.currency,
          amountBase: t.currencyConverted != null ? t.currencyConverted : t.amount,
          fxRateSnapshot: t.currencyConverted != null ? Math.abs(t.currencyConverted / t.amount) : 1,
          categoryId: catId || null,
        });
      }));

      this.set('goals', data.goals || []);
      this.set('budgets', (data.budgets || []).map(function (b) {
        var catId = (cats.find(function (c) { return c.name.toLowerCase() === (b.cat || '').toLowerCase(); }) || {}).id;
        return Object.assign({}, b, { categoryId: catId, month: new Date().toISOString().slice(0, 7), currency: 'EUR', rollover: false });
      }));
      this.set('recurring', (data.bills || []).map(function (b) {
        return {
          id: b.id, name: b.name, amount: b.amount, currency: b.currency,
          freq: 'monthly', nextDate: b.date, account: b.account, icon: b.icon, canSkip: true,
        };
      }));

      if (data.holdings) this.set('holdings', data.holdings.map(function (h, i) {
        return Object.assign({}, h, { id: h.id || ('h_seed_' + i) });
      }));
      if (data.dcaPlans) this.set('dcaPlans', data.dcaPlans);

      // Backfill openingBalance + derive every cached money field from the seeded
      // transactions. Uses the legacy-detection path (no _recomputed flag yet)
      // so visible balances are preserved.
      this.recompute();
    },

    /**
     * Backwards-compatible alias. Production callers should use
     * seedDefaultCategoriesIfEmpty; demo callers should use seedDemoData.
     */
    seedIfEmpty: function () { this.seedDefaultCategoriesIfEmpty(); },

    /**
     * Seed a starter FX rate table if `fxCache` is empty. Rates are expressed as
     * `1 unit of FROM = rate units of TO`. Users can edit via DevTools today;
     * a Settings UI is a separate task.
     */
    seedFxIfEmpty: function () {
      if (this.list('fxCache').length > 0) return;
      this.set('fxCache', [
        { from: 'USD', to: 'EUR', rate: 0.92 },
        { from: 'GBP', to: 'EUR', rate: 1.17 },
        { from: 'CHF', to: 'EUR', rate: 1.05 },
        { from: 'JPY', to: 'EUR', rate: 0.0061 },
        { from: 'CAD', to: 'EUR', rate: 0.68 },
        { from: 'AUD', to: 'EUR', rate: 0.61 },
      ]);
    },

    /**
     * Convert one unit of `from` into units of `to`. Same currency = 1.
     * Looks up `fxCache` for a direct entry; falls back to inverting the reverse
     * entry; falls back to triangulation through EUR; final fallback is 1
     * (preserves prior behavior of "same as base" when a rate is missing).
     */
    getFxRate: function (from, to) {
      if (!from || !to || from === to) return 1;
      var cache = this.list('fxCache');
      var direct = cache.find(function (r) { return r.from === from && r.to === to; });
      if (direct && direct.rate) return direct.rate;
      var inverse = cache.find(function (r) { return r.from === to && r.to === from; });
      if (inverse && inverse.rate) return 1 / inverse.rate;
      // Triangulate via EUR.
      if (from !== 'EUR' && to !== 'EUR') {
        var fromEur = this.getFxRate(from, 'EUR');
        var eurTo = this.getFxRate('EUR', to);
        if (fromEur !== 1 || eurTo !== 1) return fromEur * eurTo;
      }
      // No rate available: degrade to 1:1, but warn so a missing rate is visible
      // instead of silently treating foreign money as base currency.
      if (window.console && console.warn) {
        console.warn('[FCStore.getFxRate] no rate for ' + from + ' -> ' + to + ', using 1:1');
      }
      return 1;
    },

    /**
     * Project balances forward. Returns { history:[], projection:[{d,v}], events:[{d,t,n,a}] }.
     * Strategy:
     *   - Start value = sum of selected accounts' balances converted to base currency.
     *   - For each day in [today, today+days): apply every recurring rule whose
     *     nextDate equals or has been rolled to that day (uses freq bumping).
     *   - Returns one data point per day; the chart can downsample as needed.
     * Args:
     *   opts.days        — horizon in days (default 30)
     *   opts.accountIds  — array of account ids to include (default: all)
     *   opts.baseCurrency— output currency (default: profile.baseCurrency or 'EUR')
     */
    buildForecast: function (opts) {
      opts = opts || {};
      var days = opts.days || 30;
      var base = opts.baseCurrency
              || (window.FCAuth && (FCAuth.currentProfile() || {}).baseCurrency)
              || 'EUR';
      var accounts = this.list('accounts');
      var ids = opts.accountIds && opts.accountIds.length
              ? new Set(opts.accountIds)
              : new Set(accounts.map(function (a) { return a.id; }));
      var selected = accounts.filter(function (a) { return ids.has(a.id); });
      var self = this;
      var start = selected.reduce(function (s, a) {
        return s + (a.balance || 0) * self.getFxRate(a.currency || base, base);
      }, 0);
      var rules = this.list('recurring').filter(function (r) {
        if (!r || !r.nextDate || !r.freq) return false;
        // Include the rule if its account isn't pinned to a non-selected account.
        if (r.accountId) return ids.has(r.accountId);
        if (r.account) {
          var match = accounts.find(function (a) { return a.name === r.account; });
          if (match) return ids.has(match.id);
        }
        return true;
      });

      function ymd(d) { return ymdLocal(d); }
      function bumpFreq(d, freq) {
        if (freq === 'daily')      d.setDate(d.getDate() + 1);
        else if (freq === 'weekly')d.setDate(d.getDate() + 7);
        else if (freq === 'yearly')d.setFullYear(d.getFullYear() + 1);
        else                       addMonths(d, 1);
      }

      var today = new Date(); today.setHours(0, 0, 0, 0);
      var events = [];
      // Recurring rules store positive amounts plus a `direction` ('in' for income,
      // otherwise an outflow). Legacy rules with no direction are treated as outflows.
      rules.forEach(function (r) {
        if (r.freq === 'custom') return;
        var d = parseLocalDate(r.nextDate);
        if (isNaN(d.getTime())) return;
        var horizon = new Date(today); horizon.setDate(horizon.getDate() + days);
        var fx = self.getFxRate(r.currency || base, base);
        var raw = r.amount || 0;
        var income = r.direction === 'in' || r.type === 'income';
        var signed = income ? Math.abs(raw) : -Math.abs(raw);
        var amt = signed * fx;
        var guard = 0;
        while (d <= horizon && guard++ < 1200) {
          if (d >= today) events.push({ date: ymd(d), t: amt >= 0 ? 'in' : 'out', n: r.name || r.merchant || 'Recurring', a: amt });
          bumpFreq(d, r.freq);
        }
      });
      events.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

      // Walk day-by-day, applying events on their date.
      // Projection rows are `{ d: dayOffset, date: 'YYYY-MM-DD', v }` so consumers
      // can filter on day-offset (e.g. horizon = 60) or render the ISO date.
      var projection = [];
      var running = start;
      var byDay = {};
      events.forEach(function (e) { (byDay[e.date] = byDay[e.date] || 0); byDay[e.date] += e.a; });
      for (var i = 0; i <= days; i++) {
        var d = new Date(today); d.setDate(d.getDate() + i);
        var k = ymd(d);
        if (byDay[k]) running += byDay[k];
        projection.push({ d: i, date: k, v: Math.round(running * 100) / 100 });
      }
      return { history: [], projection: projection, events: events };
    },

    /**
     * Roll every recurring rule's `nextDate` forward until it is in the future.
     * Idempotent and safe to call every app boot. Does not create transactions —
     * recurring rules in v1 are reminders + forecast inputs, not auto-postings.
     * Custom-frequency rules and undated rules are left alone.
     */
    tickRecurring: function () {
      var pid = this.profileId();
      if (!pid) return 0;
      var rows = this.list('recurring');
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var changed = 0;
      var next = rows.map(function (r) {
        if (!r || !r.nextDate || !r.freq || r.freq === 'custom') return r;
        var d = parseLocalDate(r.nextDate);
        if (isNaN(d.getTime())) return r;
        var bumped = false;
        var guard = 0;
        while (d < today && guard++ < 600) {
          if (r.freq === 'daily')      d.setDate(d.getDate() + 1);
          else if (r.freq === 'weekly')d.setDate(d.getDate() + 7);
          else if (r.freq === 'yearly')d.setFullYear(d.getFullYear() + 1);
          else                         addMonths(d, 1);
          bumped = true;
        }
        if (!bumped) return r;
        changed++;
        return Object.assign({}, r, { nextDate: ymdLocal(d) });
      });
      if (changed) save(key(pid, 'recurring'), next);
      return changed;
    },
  };

  function defaultCategories() {
    return [
      { id: 'cat_dining',     name: 'Dining',        icon: '🍽', color: '#f59e0b' },
      { id: 'cat_groceries',  name: 'Groceries',     icon: '🛒', color: '#16a34a' },
      { id: 'cat_transport',  name: 'Transport',     icon: '🚗', color: '#2563eb' },
      { id: 'cat_subs',       name: 'Subscriptions', icon: '▶',  color: '#dc2626' },
      { id: 'cat_shopping',   name: 'Shopping',      icon: '🛍', color: '#8b5cf6' },
      { id: 'cat_health',     name: 'Health',        icon: '✚',  color: '#10b981' },
      { id: 'cat_entertain',  name: 'Entertainment', icon: '◐',  color: '#ec4899' },
      { id: 'cat_income',     name: 'Income',        icon: '💼', color: '#16a34a' },
      { id: 'cat_transfer',   name: 'Transfer',      icon: '⇆',  color: '#0d9488' },
      { id: 'cat_tech',       name: 'Tech',          icon: '◆',  color: '#6b7280' },
      { id: 'cat_housing',    name: 'Housing',       icon: '🏠', color: '#a16207' },
      { id: 'cat_utilities',  name: 'Utilities',     icon: '⚡', color: '#eab308' },
    ];
  }

  window.FCStore = FCStore;
})();
