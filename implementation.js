/* Copyright (c) Netitbe SPRL, Laurent Lasudry <laurent@netitbe.be>
 * SPDX-License-Identifier: GPL-2.0-only
 */
"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);

const PREF = "extensions.mutefolder.ids";

/**
 * Folder ids look like `<accountId>:/<path>` where path starts with "/"
 * (root folder: "<accountId>://"). Returns the id and all its ancestors.
 */
function selfAndAncestors(id) {
  const split = id.indexOf(":/");
  if (split < 0) {
    return [id];
  }
  const account = id.slice(0, split);
  const segments = id
    .slice(split + 2)
    .split("/")
    .filter(Boolean);
  const out = [];
  for (let n = segments.length; n >= 0; n--) {
    out.push(`${account}://${segments.slice(0, n).join("/")}`);
  }
  return out;
}

const STYLE_ID = "mute-folder-notifications-style";
const ATTR = "data-notifications-muted";
const CSS = `
li[is="folder-tree-row"][${ATTR}] > .container > .name::after {
  content: " \u{1F515}";
  font-size: 0.8em;
  opacity: 0.55;
}
li[is="folder-tree-row"][${ATTR}="inherited"] > .container > .name::after {
  opacity: 0.3;
}`;

var muteNotifications = class extends ExtensionCommon.ExtensionAPI {
  muted = new Set();
  patched = null;
  observers = new Map(); // about:3pane document -> MutationObserver
  windowObserver = null;

  loadPref() {
    try {
      this.muted = new Set(JSON.parse(Services.prefs.getStringPref(PREF, "[]")));
    } catch (e) {
      this.muted = new Set();
    }
  }

  folderId(folder) {
    return this.extension.folderManager.convert(folder).id;
  }

  isFolderMuted(folder) {
    try {
      if (!this.muted.size) {
        return false;
      }
      return selfAndAncestors(this.folderId(folder)).some(c => this.muted.has(c));
    } catch (e) {
      console.error("mute-folder-notifications:", e);
      return false;
    }
  }

  install() {
    if (this.patched) {
      return;
    }
    this.loadPref();

    // The notification code is a JS module in Thunderbird. Every new mail
    // alert (system alert or custom window, whichever way the mail got into
    // the folder: filter, junk move, manual move, ...) goes through
    // _getNewMsgKeysNotNotified(); reporting "nothing new" for muted folders
    // silences it. Descendants are visited one by one, so a muted folder
    // never hides new mail in an unmuted sibling.
    const { MailNotificationManager } = ChromeUtils.importESModule(
      "resource:///modules/MailNotificationManager.sys.mjs"
    );
    const proto = MailNotificationManager.prototype;
    const original = proto._getNewMsgKeysNotNotified;
    const self = this;
    proto._getNewMsgKeysNotNotified = function (folder) {
      if (self.isFolderMuted(folder)) {
        return [];
      }
      return original.call(this, folder);
    };
    this.patched = { proto, original };

    this.installIcons();
  }

  onStartup() {
    this.install();
  }

  onShutdown() {
    if (this.patched) {
      this.patched.proto._getNewMsgKeysNotNotified = this.patched.original;
      this.patched = null;
    }
    this.removeIcons();
  }

  // ---- Folder pane icon -------------------------------------------------

  installIcons() {
    this.windowObserver = {
      observe: win => {
        win.addEventListener(
          "DOMContentLoaded",
          () => {
            if (win.location.href == "about:3pane") {
              this.decorate(win.document);
            }
          },
          { once: true }
        );
      },
    };
    Services.obs.addObserver(this.windowObserver, "chrome-document-global-created");
    this.forEach3Pane(doc => this.decorate(doc));
  }

  forEach3Pane(callback) {
    for (const win of Services.wm.getEnumerator("mail:3pane")) {
      try {
        for (const tab of win.document.getElementById("tabmail").tabInfo) {
          const doc = tab.chromeBrowser?.contentDocument;
          if (doc?.location.href == "about:3pane") {
            callback(doc);
          }
        }
      } catch (e) {
        console.error("mute-folder-notifications:", e);
      }
    }
  }

  decorate(doc) {
    if (this.observers.has(doc) || !doc.getElementById("folderTree")) {
      return;
    }
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);

    let timer = null;
    const observer = new doc.defaultView.MutationObserver(() => {
      if (!timer) {
        timer = doc.defaultView.setTimeout(() => {
          timer = null;
          this.paint(doc);
        }, 50);
      }
    });
    observer.observe(doc.getElementById("folderTree"), {
      childList: true,
      subtree: true,
    });
    this.observers.set(doc, observer);
    this.paint(doc);
  }

  paint(doc) {
    const { MailServices } = ChromeUtils.importESModule(
      "resource:///modules/MailServices.sys.mjs"
    );
    for (const row of doc.querySelectorAll('li[is="folder-tree-row"]')) {
      let state = null;
      try {
        if (row.uri && this.muted.size) {
          const folder = MailServices.folderLookup.getFolderForURL(row.uri);
          if (folder && this.isFolderMuted(folder)) {
            const own = this.muted.has(this.folderId(folder));
            state = own ? "own" : "inherited";
          }
        }
      } catch (e) {
        // Ignore rows we can't resolve (e.g. smart folders).
      }
      if (state) {
        row.setAttribute(ATTR, state);
      } else {
        row.removeAttribute(ATTR);
      }
    }
  }

  removeIcons() {
    if (this.windowObserver) {
      Services.obs.removeObserver(this.windowObserver, "chrome-document-global-created");
      this.windowObserver = null;
    }
    for (const [doc, observer] of this.observers) {
      try {
        observer.disconnect();
        doc.getElementById(STYLE_ID)?.remove();
        for (const row of doc.querySelectorAll(`[${ATTR}]`)) {
          row.removeAttribute(ATTR);
        }
      } catch (e) {
        // Document already gone.
      }
    }
    this.observers.clear();
  }

  getAPI() {
    const self = this;
    // Fallback in case onStartup was not delivered.
    self.install();
    return {
      muteNotifications: {
        async getMuted() {
          return [...self.muted];
        },
        async setMuted(ids) {
          self.muted = new Set(ids);
          Services.prefs.setStringPref(PREF, JSON.stringify(ids));
          for (const doc of self.observers.keys()) {
            self.paint(doc);
          }
        },
        async isMuted(id) {
          return selfAndAncestors(id).some(c => self.muted.has(c));
        },
      },
    };
  }
};
