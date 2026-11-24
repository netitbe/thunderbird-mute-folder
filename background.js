/* Copyright (c) Netitbe SPRL, Laurent Lasudry <laurent@netitbe.be>
 * SPDX-License-Identifier: GPL-2.0-only
 */
const MENU_ID = "mute-folder-notifications";
const TITLE = "Mute new mail notifications";
const TITLE_INHERITED = "Notifications muted (by a parent folder)";

messenger.menus.create({
  id: MENU_ID,
  type: "checkbox",
  title: TITLE,
  contexts: ["folder_pane"],
});

messenger.menus.onShown.addListener(async info => {
  const folder = info.selectedFolders?.[0];
  if (!folder) {
    return;
  }
  const own = (await messenger.muteNotifications.getMuted()).includes(folder.id);
  const inherited =
    !own && (await messenger.muteNotifications.isMuted(folder.id));
  await messenger.menus.update(MENU_ID, {
    checked: own || inherited,
    enabled: !inherited,
    title: inherited ? TITLE_INHERITED : TITLE,
  });
  messenger.menus.refresh();
});

messenger.menus.onClicked.addListener(async info => {
  if (info.menuItemId !== MENU_ID || !info.selectedFolders?.length) {
    return;
  }
  const muted = new Set(await messenger.muteNotifications.getMuted());
  for (const folder of info.selectedFolders) {
    if (info.checked) {
      muted.add(folder.id);
    } else {
      muted.delete(folder.id);
    }
  }
  await messenger.muteNotifications.setMuted([...muted]);
});

// Keep the muted state when a folder is renamed or moved (subfolders too).
async function followFolder(oldFolder, newFolder) {
  const muted = await messenger.muteNotifications.getMuted();
  let changed = false;
  const updated = muted.map(id => {
    if (id === oldFolder.id || id.startsWith(oldFolder.id + "/")) {
      changed = true;
      return newFolder.id + id.slice(oldFolder.id.length);
    }
    return id;
  });
  if (changed) {
    await messenger.muteNotifications.setMuted(updated);
  }
}
messenger.folders.onRenamed.addListener(followFolder);
messenger.folders.onMoved.addListener(followFolder);
