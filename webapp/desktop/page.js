// Shared desktop page bootstrap.
// Each desktop HTML sets `window.FC_ACTIVE` (e.g. 'home') and includes this script.
// Responsibilities:
//   1. Auth guard — redirect to login if not signed in.
//   2. Seed the local store from mock data on first run.
//   3. Mount the React shell with the active screen.
//   4. Persist theme / accent / privacy-blur to the profile.
//   5. Cross-page navigation via real URL changes.
//
// Inputs:  window.FC_ACTIVE (string), window.FC_LIVE (object | null)
// Outputs: mounts React into #root.

(function () {
  // 1) Guard.
  if (!window.FCAuth || !FCAuth.requireSession()) return;

  function loadOpts() {
    var p = FCAuth.currentProfile() || {};
    if (p.theme) document.documentElement.dataset.theme = p.theme;
    if (p.accent) document.documentElement.dataset.accent = p.accent;
    return p;
  }

  function navigateTo(id) {
    if (id === 'settings') { location.href = 'settings.html'; return; }
    if (id === 'profiles') { location.href = '../login.html'; return; }
    location.href = id + '.html';
  }

  function buildLiveData(profile) {
    // Compose a "data" object that screens consume. Production build: no mock fallback —
    // empty tables stay empty so the user sees their real (empty) state. The demo build
    // overrides this in its own page.js to fall back to mock data for design preview.
    var fc = window.FCStore;
    var mock = window.FCData || {};
    var base = profile.baseCurrency || 'EUR';

    // Demo build: fall back to window.FCData mock for any empty table so the design
    // preview stays populated even before seedDemoData runs. Net worth + holdings
    // value - credit-card cycle spend still run through the real engine.
    var accounts = fc.list('accounts'); if (!accounts.length) accounts = mock.accounts || [];
    var holdings = fc.list('holdings'); if (!holdings.length) holdings = mock.holdings || [];
    var cards = fc.list('cards'); if (!cards.length) cards = mock.cards || [];
    var txns = fc.list('transactions'); if (!txns.length) txns = mock.transactions || [];
    var goals = fc.list('goals'); if (!goals.length) goals = mock.goals || [];
    var budgets = fc.list('budgets'); if (!budgets.length) budgets = mock.budgets || [];
    var recurring = fc.list('recurring'); if (!recurring.length) recurring = mock.bills || mock.recurring || [];
    var categories = fc.list('categories'); if (!categories.length) categories = mock.categories || [];
    var accountTotal = accounts.reduce(function (s, a) {
      return s + (a.balance || 0) * fc.getFxRate(a.currency || base, base);
    }, 0);
    var holdingsTotal = holdings.reduce(function (s, h) {
      var px = h.price != null ? h.price : (h.avgCost || h.basis || 0);
      return s + (h.qty || 0) * px * fc.getFxRate(h.currency || base, base);
    }, 0);
    var creditDebt = cards.reduce(function (s, c) {
      if (c.kind !== 'credit') return s;
      return s + (c.cycleSpend || 0) * fc.getFxRate(c.currency || base, base);
    }, 0);
    var netWorth = accountTotal + holdingsTotal - creditDebt;

    return {
      profile: {
        name: profile.name || 'You',
        initials: profile.initials || (profile.name || 'U').slice(0, 2).toUpperCase(),
        baseCurrency: base,
        activeCurrencies: profile.activeCurrencies || ['EUR'],
      },
      accounts: accounts,
      cards: cards,
      transactions: txns,
      goals: goals,
      budgets: budgets,
      bills: recurring,
      holdings: holdings,
      categories: categories,
      forecast: fc.buildForecast({ days: 30, baseCurrency: base }),
      netWorthSpark: mock.netWorthSpark || [],
      netWorthBase: Math.round(netWorth * 100) / 100,
      netWorthDelta: mock.netWorthDelta != null ? mock.netWorthDelta : 0,
      profiles: [],
      today: new Date(),
      importStaging: [],
    };
  }

  function boot() {
    if (!window.FC || !window.FC.DesktopShell || !window.FC.HomeScreen) {
      setTimeout(boot, 30);
      return;
    }

    var profile = loadOpts();

    // 2) Seed FULL demo data on first run for this profile (demo build).
    if (window.FCStore) {
      FCStore.seedDemoData();
      if (typeof FCStore.seedFxIfEmpty === 'function') FCStore.seedFxIfEmpty();
      if (typeof FCStore.tickRecurring === 'function') FCStore.tickRecurring();
    }

    // Idle auto-lock — re-checks profile each tick so the setting takes effect
    // without a reload. No-op unless the user set both a PIN and idleLockMinutes > 0.
    // Tracks wall-clock lastActivityAt so a tab hidden longer than the timeout
    // locks on return (raw setTimeout doesn't fire reliably in background tabs).
    (function setupIdleLock() {
      var idleTimer = null;
      var lastActivityAt = Date.now();
      function lockNow() {
        FCAuth.setPinLocked(true);
        var prefix = location.pathname.indexOf('/desktop/') >= 0 ? '../' : '';
        location.replace(prefix + 'pin.html');
      }
      function reset() {
        lastActivityAt = Date.now();
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        var p = FCAuth.currentProfile() || {};
        var mins = parseFloat(p.idleLockMinutes);
        if (!p.pin || !mins || mins <= 0) return;
        idleTimer = setTimeout(lockNow, mins * 60 * 1000);
      }
      function checkOnVisible() {
        if (document.visibilityState !== 'visible') return;
        var p = FCAuth.currentProfile() || {};
        var mins = parseFloat(p.idleLockMinutes);
        if (!p.pin || !mins || mins <= 0) return;
        if (Date.now() - lastActivityAt >= mins * 60 * 1000) { lockNow(); return; }
        reset();
      }
      ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(function (ev) {
        document.addEventListener(ev, reset, { passive: true });
      });
      document.addEventListener('visibilitychange', checkOnVisible);
      reset();
    })();

    var data = buildLiveData(profile);

    function App() {
      var R = React;
      var initialBlur = profile.privacyDefault === true;
      var s = R.useState(initialBlur);
      var blurred = s[0], setBlurred = s[1];
      var qs = R.useState('');
      var query = qs[0], setQuery = qs[1];
      var ds = R.useState(data);
      var liveData = ds[0], setLiveData = ds[1];

      // Refresh data after any save so screens reflect the new row.
      R.useEffect(function () {
        function onSaved() { setLiveData(buildLiveData(FCAuth.currentProfile() || profile)); }
        var events = [
          'fc:tx-saved', 'fc:account-saved', 'fc:card-saved',
          'fc:goal-saved', 'fc:budget-saved', 'fc:recurring-saved',
          'fc:holdings-changed',
        ];
        events.forEach(function (ev) { window.addEventListener(ev, onSaved); });
        return function () { events.forEach(function (ev) { window.removeEventListener(ev, onSaved); }); };
      }, []);

      // Keyboard shortcuts (Cmd/Ctrl+K, +B, +N, +,, +1..9)
      R.useEffect(function () {
        function onKey(e) {
          var meta = e.metaKey || e.ctrlKey;
          if (!meta) return;
          if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setBlurred(function (b) { return !b; }); return; }
          if (e.key === 'k' || e.key === 'K') { e.preventDefault(); var inp = document.querySelector('header input'); if (inp) inp.focus(); return; }
          if (e.key === ',')                    { e.preventDefault(); navigateTo('settings'); return; }
          if (e.key === 'n' || e.key === 'N')   { e.preventDefault(); window.dispatchEvent(new Event('fc:add-transaction')); return; }
          var n = parseInt(e.key, 10);
          if (n >= 1 && n <= 9) {
            e.preventDefault();
            var nav = ['home','accounts','cards','transactions','forecast','simulator','goals','budgets','recurring'];
            navigateTo(nav[n - 1]);
          }
        }
        window.addEventListener('keydown', onKey);
        return function () { window.removeEventListener('keydown', onKey); };
      }, []);

      var mapKey = window.FC_ACTIVE || 'home';
      var screenMap = {
        home:'HomeScreen', forecast:'ForecastScreen', transactions:'TransactionsScreen',
        goals:'GoalsScreen', accounts:'AccountsScreen', budgets:'BudgetsScreen',
        recurring:'RecurringScreen', investments:'InvestmentsScreen', networth:'NetWorthScreen',
        cards:'CardsScreen', import:'ImportScreen', simulator:'SimulatorScreen',
        profiles:'ProfilePickerScreen', onboarding:'OnboardingScreen',
        settings:'SettingsScreen',
      };
      var Screen = window.FC[screenMap[mapKey]] || window.FC.HomeScreen;

      return R.createElement(R.Fragment, null,
        R.createElement(window.FC.DesktopShell, {
          active: mapKey,
          onNav: navigateTo,
          blurred: blurred,
          onTogglePrivacy: function () { setBlurred(function (b) { return !b; }); },
          theme: document.documentElement.dataset.theme,
          onToggleTheme: function () {
            var t = document.documentElement.dataset.theme;
            var next = t === 'dark' ? 'light' : 'dark';
            document.documentElement.dataset.theme = next;
            FCAuth.updateProfile({ theme: next });
          },
          accent: document.documentElement.dataset.accent,
          onSetAccent: function (acc) {
            document.documentElement.dataset.accent = acc;
            FCAuth.updateProfile({ accent: acc });
          },
          density: profile.density || 'comfortable',
          profile: liveData.profile,
          query: query,
          setQuery: setQuery,
          onLogout: function () { FCAuth.logout(); location.replace('../login.html'); },
        }, R.createElement(Screen, {
          blurred: blurred,
          density: profile.density || 'comfortable',
          displayFont: 'Geist',
          data: liveData,
          onNav: navigateTo,
        })),
        window.FC.AddTransactionModal ? R.createElement(window.FC.AddTransactionModal) : null,
        window.FC.CrudModals ? R.createElement(window.FC.CrudModals) : null,
        window.FC.HoldingFormModal ? R.createElement(window.FC.HoldingFormModal) : null,
        window.FC.BulkDeleteTxModal ? R.createElement(window.FC.BulkDeleteTxModal) : null
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
  }

  boot();
})();
