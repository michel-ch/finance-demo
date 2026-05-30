// Auth & session management — localStorage-based, local-first.
// Per master-spec §5: schema is multi-user-ready, but v1 has a single implicit profile.
// We add a simple email+password gate to demonstrate login/logout, plus optional PIN.

(function () {
  var KEY_PROFILES = 'fc.profiles.v1';
  var KEY_SESSION  = 'fc.session.v1';
  var KEY_PIN_LOCK = 'fc.pinLocked.v1';

  function load(k, def) {
    try { return JSON.parse(localStorage.getItem(k)) || def; } catch (e) { return def; }
  }
  function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  // Legacy djb2: kept only so existing profiles can still authenticate while
  // their hash is upgraded in place to SHA-256 on next successful login.
  function hashDjb2(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h);
  }

  // Modern hash. Returns a 64-char hex string from a Promise.
  function hashSha256(s) {
    var enc = new TextEncoder().encode(String(s));
    return crypto.subtle.digest('SHA-256', enc).then(function (buf) {
      var b = new Uint8Array(buf);
      var hex = '';
      for (var i = 0; i < b.length; i++) hex += b[i].toString(16).padStart(2, '0');
      return hex;
    });
  }

  // SHA-256 hex is 64 chars; djb2 is short (often <= 11 chars including a sign).
  // Use length to discriminate which verifier to try first.
  function isLegacyHash(h) { return typeof h === 'string' && h.length < 16; }

  function nowIso() { return new Date().toISOString(); }

  var FCAuth = {
    listProfiles: function () { return load(KEY_PROFILES, []); },

    hasAnyProfile: function () { return this.listProfiles().length > 0; },

    currentProfile: function () {
      var s = load(KEY_SESSION, null);
      if (!s) return null;
      var p = this.listProfiles().find(function (x) { return x.id === s.profileId; });
      return p || null;
    },

    isLoggedIn: function () { return !!this.currentProfile(); },

    isPinLocked: function () {
      var p = this.currentProfile();
      if (!p || !p.pin) return false;
      return load(KEY_PIN_LOCK, false) === true;
    },

    setPinLocked: function (locked) { save(KEY_PIN_LOCK, !!locked); },

    signup: function (data) {
      // data: { name, email, password, baseCurrency, activeCurrencies }
      // Returns a Promise. SHA-256 is async; signup chains through hashSha256
      // and login (which is also async to handle the legacy-hash upgrade path).
      var self = this;
      var profiles = this.listProfiles();
      if (profiles.some(function (p) { return p.email.toLowerCase() === data.email.toLowerCase(); })) {
        return Promise.reject(new Error('An account with this email already exists.'));
      }
      var initials = (data.name || data.email).split(/\s+/).filter(function (w) { return w.length > 0; }).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase();
      return hashSha256(data.password).then(function (hashed) {
        var profile = {
          id: 'p_' + Date.now(),
          name: data.name,
          email: data.email,
          passwordHash: hashed,
          initials: initials,
          baseCurrency: data.baseCurrency || 'EUR',
          activeCurrencies: data.activeCurrencies || ['EUR', 'USD', 'GBP'],
          createdAt: nowIso(),
          pin: null,
          theme: 'dark',
          accent: 'teal',
          density: 'comfortable',
          privacyDefault: false,
          idleLockMinutes: 0,
          startBlurred: false,
          householdId: 'h_' + Date.now(),
        };
        profiles.push(profile);
        save(KEY_PROFILES, profiles);
        return self.login(data.email, data.password).then(function () { return profile; });
      });
    },

    login: function (email, password) {
      // Returns a Promise resolving to the profile, or rejecting on bad credentials.
      // Dual-verify: try SHA-256 first; on miss, fall back to legacy djb2 and
      // upgrade the stored hash in place so the next login uses SHA-256 only.
      var profiles = this.listProfiles();
      var candidate = profiles.find(function (p) { return p.email.toLowerCase() === email.toLowerCase(); });
      if (!candidate) return Promise.reject(new Error('Wrong email or password.'));
      function finish(match) {
        save(KEY_SESSION, { profileId: match.id, loggedInAt: nowIso() });
        save(KEY_PIN_LOCK, !!match.pin);
        return match;
      }
      var self = this;
      return hashSha256(password).then(function (sha) {
        if (candidate.passwordHash === sha) return finish(candidate);
        if (isLegacyHash(candidate.passwordHash) && candidate.passwordHash === hashDjb2(password)) {
          self.updateProfileById(candidate.id, { passwordHash: sha });
          return finish(Object.assign({}, candidate, { passwordHash: sha }));
        }
        throw new Error('Wrong email or password.');
      });
    },

    // Internal: update a profile by id without requiring an active session.
    // Used during the legacy-hash upgrade path on login.
    updateProfileById: function (id, patch) {
      var profiles = this.listProfiles();
      var i = profiles.findIndex(function (p) { return p.id === id; });
      if (i < 0) return null;
      profiles[i] = Object.assign({}, profiles[i], patch);
      save(KEY_PROFILES, profiles);
      return profiles[i];
    },

    logout: function () {
      localStorage.removeItem(KEY_SESSION);
      localStorage.removeItem(KEY_PIN_LOCK);
    },

    updateProfile: function (patch) {
      var s = load(KEY_SESSION, null);
      if (!s) return null;
      var profiles = this.listProfiles();
      var i = profiles.findIndex(function (p) { return p.id === s.profileId; });
      if (i < 0) return null;
      profiles[i] = Object.assign({}, profiles[i], patch);
      save(KEY_PROFILES, profiles);
      return profiles[i];
    },

    setPin: function (pin) {
      // Returns a Promise. PIN is hashed with SHA-256 to match passwords.
      var self = this;
      var p = this.currentProfile();
      if (!p) return Promise.resolve(null);
      if (!pin) { this.updateProfile({ pin: null }); return Promise.resolve(null); }
      return hashSha256(pin).then(function (h) {
        self.updateProfile({ pin: h });
        return h;
      });
    },

    verifyPin: function (pin) {
      // Returns a Promise<boolean>. Dual-verify with in-place upgrade if a
      // legacy djb2 PIN hash is still on file.
      var self = this;
      var p = this.currentProfile();
      if (!p || !p.pin) return Promise.resolve(true);
      return hashSha256(pin).then(function (sha) {
        if (sha === p.pin) return true;
        if (isLegacyHash(p.pin) && hashDjb2(pin) === p.pin) {
          self.updateProfile({ pin: sha });
          return true;
        }
        return false;
      });
    },

    firstRoute: function () {
      if (!this.hasAnyProfile()) return 'signup.html';
      if (!this.isLoggedIn()) return 'login.html';
      if (this.isPinLocked()) return 'pin.html';
      var p = this.currentProfile();
      if (!p.onboarded) return 'desktop/onboarding.html';
      return 'desktop/home.html';
    },

    /**
     * Guard: call at the top of every protected page.
     * Redirects to login if not authenticated, or to PIN unlock if locked.
     */
    requireSession: function (opts) {
      opts = opts || {};
      var here = location.pathname.split('/').pop();
      // Pages under /desktop/ or /mobile/ need to climb one level to reach the
      // webapp root where login.html and pin.html live.
      var inSub = location.pathname.indexOf('/desktop/') >= 0 || location.pathname.indexOf('/mobile/') >= 0;
      var prefix = inSub ? '../' : '';
      if (!this.isLoggedIn()) {
        location.replace(prefix + 'login.html');
        return false;
      }
      if (this.isPinLocked() && here !== 'pin.html') {
        location.replace(prefix + 'pin.html');
        return false;
      }
      return true;
    },
  };

  window.FCAuth = FCAuth;
})();
