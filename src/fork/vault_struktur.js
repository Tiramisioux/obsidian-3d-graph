// vendored from obsidian-vault-functions/lib/vault_struktur.js sha1:9bd95153d88fe1bfa121217c48046a04b33a6b14 — do not edit here
// Reference library for the vault tree contract (version 1) - JS twin of vault_struktur.py.
//
// Same API, identical snake_case names, tested against the same vault_struktur_cases.json.
// CommonJS, no dependencies.  The file is inlined into plugins and scripts between marker
// lines (see check_vendored.py): never edit a copy.  `load` requires fs/path inside the
// function only.  All names are NFC in and out and bare (no leading "#"); paths are
// vault-relative with "/".
const VaultStruktur = (function () {
  "use strict";

  const MISSING_MESSAGE = (root) => "vault-struktur.json saknas i " + root + "/.obsidian — väntar på omstruktureringen";
  const REQUIRED = ["version", "områden", "arkiv", "anteckningar", "analog", "inkorg", "standardkontext"];
  const CAPS_RE = /^[A-ZÅÄÖÉÈ0-9_-]+$/;
  const LETTER_RE = /[A-ZÅÄÖÉÈ]/;
  const HUB_LIKE_RE = /^_?[0-9]{14}\s+.+\s+hub\.md$/;
  const TOKEN_END = "(?![0-9A-Za-z_\\u00C0-\\u024F])";
  const SV_MAP = { "å": "{", "ä": "|", "ö": "}", "é": "e", "è": "e" };

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // ---------------------------------------------------------------- module-level helpers

  function nfc(s) {
    if (s === null || s === undefined) return null;
    return String(s).normalize("NFC");
  }

  function compare_key(s) {
    return (nfc(s) || "").toLowerCase();
  }

  function sv_key(s) {
    return (nfc(s) || "").toLowerCase().replace(/[åäöéè]/g, (c) => SV_MAP[c]);
  }

  function is_caps(token) {
    if (typeof token !== "string") return false;
    const t = nfc(token);
    return CAPS_RE.test(t) && LETTER_RE.test(t);
  }

  function hub_content(kontext, projekt, datum, template_text) {
    const k = nfc(kontext);
    const p = nfc(projekt) || k;
    const fm = "---\ndatum: " + datum + "\nkontext: " + k + "\nprojekt: \"#" + p + "\"\nfritext: \"\"\ntyp: hub\n" +
      "type: projektplanering\n---\n\n# " + p + "\n\n";
    const m = /^---([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(template_text);
    if (!m) throw new Error("hubmallen saknar frontmatter");
    const head = m[1].replace(/\r/g, "");
    let body = m[2];
    const fm_value = (key) => {
      const r = new RegExp("^" + key + ":[ \\t]*(.*?)[ \\t]*$", "m").exec(head);
      let v = r ? r[1] : "";
      if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === "\"" || v[0] === "'")) v = v.slice(1, -1);
      return v.replace(/^#+/, "");
    };
    const kt = fm_value("kontext");
    const pt = fm_value("projekt");
    if (!kt || !pt) throw new Error("hubmallen saknar kontext/projekt i frontmatter");
    if (p === k) body = body.replace(new RegExp("^#" + esc(pt) + TOKEN_END + "[ \\t]*\\n", "gm"), "");
    body = body.replace(new RegExp("#" + esc(kt) + TOKEN_END, "g"), () => "#" + k);
    body = body.replace(new RegExp("#" + esc(pt) + TOKEN_END, "g"), () => "#" + p);
    return fm + body;
  }

  function from_config(cfg, list_dir) {
    return new Struktur(cfg, list_dir, null);
  }

  function load(vault) {
    const fs = require("fs");
    const path = require("path");
    const root = String(vault).replace(/\/+$/, "");
    const cfg_file = path.join(root, ".obsidian", "vault-struktur.json");
    if (!fs.existsSync(cfg_file) || !fs.statSync(cfg_file).isFile()) throw new Error(MISSING_MESSAGE(root));
    const cfg = JSON.parse(fs.readFileSync(cfg_file, "utf8"));
    const list_dir = (rel) => {
      const full = rel ? path.join(root, rel) : root;
      let ents;
      try {
        ents = fs.readdirSync(full, { withFileTypes: true });
      } catch (e) {
        if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) return null;
        throw e;
      }
      return ents.map((d) => {
        let dir = d.isDirectory();
        if (!dir && d.isSymbolicLink()) {
          try { dir = fs.statSync(path.join(full, d.name)).isDirectory(); } catch (e) { dir = false; }
        }
        return { name: d.name, dir: dir };
      });
    };
    return new Struktur(cfg, list_dir, root);
  }

  function projekt_is(fm, kontext) {
    const v = fm["projekt"];
    const items = Array.isArray(v) ? v : [v];
    return items.some((item) => typeof item === "string" && nfc(item).trim().replace(/^["']+|["']+$/g, "").replace(/^#+/, "") === kontext);
  }

  // ---------------------------------------------------------------- the struktur object

  class Struktur {
    constructor(cfg, list_dir, root) {
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error("vault-struktur.json: ogiltigt innehåll");
      for (const key of REQUIRED) {
        if (!(key in cfg)) throw new Error("vault-struktur.json: nyckeln " + key + " saknas");
      }
      if (cfg.version !== 1) throw new Error("vault-struktur.json: version 1 förväntades");
      this.config = cfg;
      this.fm_of = null;
      this._list_dir = list_dir;
      this._root = root;
      this._cache = new Map();
      this._res = new Map();
      this._arkiv = nfc(cfg.arkiv);
      this._notes = nfc(cfg.anteckningar);
      this._analog = nfc(cfg.analog);
      this._inkorg = nfc(cfg.inkorg);
      this._std = nfc(cfg.standardkontext);
      this._by_mapp = new Map();
      this._fixed = new Map();
      this._areas = [];
      this._open = null;
      for (const a of cfg["områden"]) {
        const mapp = nfc(a.mapp);
        const kt = a.kontext ? nfc(a.kontext) : null;
        this._areas.push([mapp, kt]);
        this._by_mapp.set(mapp, kt);
        if (kt === null) {
          if (this._open === null) this._open = mapp;
        } else {
          this._fixed.set(kt, mapp);
        }
      }
    }

    // ------------------------------------------------------------ plumbing

    refresh() {
      this._cache = new Map();
    }

    _ls(rel) {
      if (this._cache.has(rel)) return this._cache.get(rel);
      const raw = this._list_dir(rel);
      const val = raw === null || raw === undefined ? null : raw.map((e) => ({ name: nfc(e.name), dir: !!e.dir }));
      this._cache.set(rel, val);
      return val;
    }

    _has_dir(rel) {
      return this._ls(rel) !== null;
    }

    _dirs(rel) {
      return (this._ls(rel) || []).filter((e) => e.dir).map((e) => e.name);
    }

    _files(rel) {
      return (this._ls(rel) || []).filter((e) => !e.dir).map((e) => e.name);
    }

    _reserved(name) {
      return name[0] === "_" || name[0] === "." || name === this._notes || name === this._analog;
    }

    _is_name(name) {
      return !!name && !this._reserved(name) && is_caps(name);
    }

    _hub_re(k, p) {
      const key = k + "\u0000" + (p === null ? "" : p);
      let rx = this._res.get(key);
      if (!rx) {
        if (p === null || (p === k && !this._fixed.has(k))) {
          rx = new RegExp("^_?[0-9]{14}\\s+" + esc(k) + "(\\s+hub)?\\.md$");
        } else {
          rx = new RegExp("^_?[0-9]{14}\\s+" + esc(k) + "(\\s+" + esc(p) + ")?(\\s+hub)?\\.md$");
        }
        this._res.set(key, rx);
      }
      return rx;
    }

    _kontext_loc(k) {
      const act = this._open + "/" + k;
      const arc = this._open + "/" + this._arkiv + "/" + k;
      if (this._has_dir(act)) return [act, false];
      if (this._has_dir(arc)) return [arc, true];
      return [act, false];
    }

    _project_locations(k, include_archived) {
      if (this._fixed.has(k)) {
        const base = this._fixed.get(k);
        if (!this._has_dir(base)) return [];
        const locs = [[base, false]];
        if (include_archived) locs.push([base + "/" + this._arkiv, true]);
        return locs;
      }
      if (this._open === null) return [];
      const [base, karch] = this._kontext_loc(k);
      if (!this._has_dir(base)) return [];
      if (karch) return include_archived ? [[base, true], [base + "/" + this._arkiv, true]] : [];
      const locs = [[base, false]];
      if (include_archived) locs.push([base + "/" + this._arkiv, true]);
      return locs;
    }

    _read_fm(fm_of) {
      return fm_of || this.fm_of || null;
    }

    // ------------------------------------------------------------ resolution

    resolve(path) {
      const out = { "område": null, "kontext": null, "projekt": null, "arkiverad": false, "roll": null, "kontextnivå": false };
      const segs = (nfc(path) || "").replace(/^\/+|\/+$/g, "").split("/").filter((x) => x);
      if (!segs.length || !this._by_mapp.has(segs[0])) return out;
      out["område"] = segs[0];
      let k = this._by_mapp.get(segs[0]);
      const fixed = k !== null;
      let s = segs.slice(1);
      let arch = false;
      let in_arch = false;
      if (s.length && s[0] === this._arkiv) {
        arch = in_arch = true;
        s = s.slice(1);
      }
      let p = null;
      if (!fixed) {
        if (!(s.length && this._is_name(s[0]))) {
          out["arkiverad"] = arch;
          out["roll"] = s.length ? "other" : null;
          return out;
        }
        k = s[0];
        s = s.slice(1);
        in_arch = false;
        p = k;
        if (s.length && s[0] === this._arkiv) {
          arch = in_arch = true;
          s = s.slice(1);
        }
      }
      out["kontext"] = k;
      out["arkiverad"] = arch;
      if (s.length && this._is_name(s[0])) {
        p = s[0];
        out["roll"] = this._project_roll(k, p, s.slice(1));
      } else {
        out["roll"] = this._kontext_roll(k, s, in_arch);
      }
      out["projekt"] = p;
      out["kontextnivå"] = fixed ? p === null : p === k;
      return out;
    }

    _project_roll(k, p, rest) {
      if (!rest.length) return null;
      if (rest[0] === this._notes) return "notes";
      if (rest[0] === this._analog) return "analog";
      if (rest.length === 1 && this._hub_re(k, p).test(rest[0])) return "hub";
      return "other";
    }

    _kontext_roll(k, s, in_arch) {
      if (!s.length) return null;
      if (in_arch) return "other";
      if (s[0] === this._notes) return "notes";
      if (s[0] === this._analog) return "analog";
      if (s.length === 1 && s[0] === this._inkorg) return "inbox";
      if (!this._fixed.has(k) && s.length === 1 && this._hub_re(k, null).test(s[0])) return "hub";
      return "other";
    }

    is_archived(path) {
      return this.resolve(path)["arkiverad"];
    }

    // ------------------------------------------------------------ folders

    kontext_folder(kontext, arkiverad) {
      const k = nfc(kontext);
      if (this._fixed.has(k)) return this._fixed.get(k);
      if (this._open === null) return null;
      const act = this._open + "/" + k;
      const arc = this._open + "/" + this._arkiv + "/" + k;
      if (arkiverad === true) return arc;
      if (arkiverad === false) return act;
      return this._kontext_loc(k)[0];
    }

    folder_of(kontext, projekt, arkiverad) {
      const k = nfc(kontext);
      const p = projekt ? nfc(projekt) : null;
      if (p === null || p === k) return this._fixed.has(k) ? null : this.kontext_folder(k, arkiverad);
      let base;
      let karch = false;
      if (this._fixed.has(k)) {
        base = this._fixed.get(k);
      } else {
        if (this._open === null) return null;
        [base, karch] = this._kontext_loc(k);
      }
      if (karch) return base + "/" + p;
      const act = base + "/" + p;
      const arc = base + "/" + this._arkiv + "/" + p;
      if (arkiverad === true) return arc;
      if (arkiverad === false) return act;
      if (this._has_dir(act)) return act;
      if (this._has_dir(arc)) return arc;
      return act;
    }

    _level_folder(kontext, projekt, arkiverad) {
      const f = this.folder_of(kontext, projekt, arkiverad);
      return f === null ? this.kontext_folder(kontext) : f;
    }

    notes_folder(kontext, projekt, arkiverad) {
      const f = this._level_folder(kontext, projekt, arkiverad);
      return f === null ? null : f + "/" + this._notes;
    }

    analog_folder(kontext, projekt, arkiverad) {
      const f = this._level_folder(kontext, projekt, arkiverad);
      return f === null ? null : f + "/" + this._analog;
    }

    inbox_path(kontext) {
      const f = this.kontext_folder(kontext);
      return f === null ? null : f + "/" + this._inkorg;
    }

    // ------------------------------------------------------------ hubs

    new_hub_name(kontext, projekt, ts) {
      const k = nfc(kontext);
      const p = projekt ? nfc(projekt) : null;
      if (p === null || p === k) return ts + " " + k + " hub.md";
      return ts + " " + k + " " + p + " hub.md";
    }

    hub_path(kontext, projekt, arkiverad, fm_of) {
      const k = nfc(kontext);
      let p = projekt ? nfc(projekt) : null;
      if (p === k) p = null;
      if (p === null && this._fixed.has(k)) return null;
      const folder = this.folder_of(k, p, arkiverad);
      if (folder === null) return null;
      return this._hub_at(folder, k, p, fm_of);
    }

    _hub_at(folder, k, p, fm_of) {
      const rx = this._hub_re(k, p);
      const found = this._files(folder).filter((n) => rx.test(n));
      if (found.length) {
        found.sort((a, b) => cmp(a.endsWith(" hub.md") ? 0 : 1, b.endsWith(" hub.md") ? 0 : 1) || cmp(a, b));
        return folder + "/" + found[0];
      }
      const fm = this._read_fm(fm_of);
      if (p === null && !this._fixed.has(k) && fm) {
        let dirs = [folder];
        for (const loc of [folder, folder + "/" + this._arkiv]) {
          dirs = dirs.concat(this._dirs(loc).filter((n) => this._is_name(n)).map((n) => loc + "/" + n));
        }
        let cands = [];
        for (const d of dirs) {
          cands = cands.concat(this._files(d).filter((n) => HUB_LIKE_RE.test(n)).map((n) => d + "/" + n));
        }
        cands.sort(cmp);
        for (const cand of cands) {
          const meta = fm(cand);
          if (meta && projekt_is(meta, k)) return cand;
        }
      }
      return null;
    }

    // ------------------------------------------------------------ lists

    list_kontexts(include_archived) {
      const names = new Set();
      for (const [mapp, kt] of this._areas) {
        if (kt !== null && this._has_dir(mapp)) names.add(kt);
      }
      if (this._open !== null) {
        const locs = [this._open];
        if (include_archived) locs.push(this._open + "/" + this._arkiv);
        for (const loc of locs) {
          for (const n of this._dirs(loc)) if (this._is_name(n)) names.add(n);
        }
      }
      return Array.from(names).sort((a, b) => cmp(sv_key(a), sv_key(b)) || cmp(a, b));
    }

    list_projects(kontext, include_archived) {
      const k = nfc(kontext);
      const names = new Set();
      for (const [loc] of this._project_locations(k, !!include_archived)) {
        for (const n of this._dirs(loc)) if (this._is_name(n) && n !== k) names.add(n);
      }
      return Array.from(names).sort((a, b) => cmp(sv_key(a), sv_key(b)) || cmp(a, b));
    }

    find_project(projekt, kontext) {
      const want = compare_key(projekt);
      const kwant = kontext ? compare_key(kontext) : null;
      const out = [];
      for (const k of this.list_kontexts(true)) {
        if (kwant !== null && compare_key(k) !== kwant) continue;
        for (const [loc, arch] of this._project_locations(k, true)) {
          for (const n of this._dirs(loc)) {
            if (this._is_name(n) && n !== k && compare_key(n) === want) {
              const folder = loc + "/" + n;
              out.push({ kontext: k, projekt: n, arkiverad: arch, folder: folder, hub: this._hub_at(folder, k, n, null) });
            }
          }
        }
        if (!this._fixed.has(k) && this._open !== null && compare_key(k) === want) {
          for (const [folder, arch] of [[this._open + "/" + k, false], [this._open + "/" + this._arkiv + "/" + k, true]]) {
            if (this._has_dir(folder)) {
              out.push({ kontext: k, projekt: k, arkiverad: arch, folder: folder, hub: this._hub_at(folder, k, null, null) });
            }
          }
        }
      }
      const rank = (e) => [e.arkiverad ? 1 : 0, e.kontext === this._std ? 0 : 1, sv_key(e.kontext), e.kontext, sv_key(e.projekt), e.projekt];
      out.sort((a, b) => {
        const x = rank(a);
        const y = rank(b);
        for (let i = 0; i < x.length; i++) {
          const c = cmp(x[i], y[i]);
          if (c) return c;
        }
        return 0;
      });
      return out;
    }
  }

  return { load, from_config, is_caps, nfc, compare_key, sv_key, hub_content };
})();
if (typeof module === "object" && module && module.exports) module.exports = VaultStruktur;
