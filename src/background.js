import * as clipboard from "./clipboard.mjs"

console.log("Attach from Clipboard version", browser.runtime.getManifest().version);

// Legacy: Inject menu into all already open compose windows, and into any new
//         compose window being opened.
// Note:   Can be removed once a proper context for the composer's attach menu
//         has been implemented (compose_attachment_area and compose_menu_attach).
async function injectMenu(windowId) {
    try {
        await browser.AttachMenu.inject(windowId);
    } catch (e) {
        console.error("Attach from Clipboard: could not inject menu", e);
    }
}

async function attachFromClipboard(tab) {
    try {
        await clipboard.insertFromClipboard(tab);
    } catch (e) {
        console.error("Attach from Clipboard failed", e);
        try {
            await browser.notifications.create({
                type: "basic",
                title: "Attach from Clipboard v" + browser.runtime.getManifest().version + " failed",
                message: String(e?.message ?? e) + " | " + clipboard.getDiagnostics(),
            });
        } catch (e2) { /* ignore */ }
    }
}

// Register listeners first so the keyboard shortcut works even if the menu
// injection fails.
messenger.commands.onCommand.addListener((name, tab) => {
    if (name == "insert_from_clipboard") {
        attachFromClipboard(tab);
    }
});
messenger.AttachMenu.onClicked.addListener(tab => {
    attachFromClipboard(tab);
});
// Standard toolbar button and menu entries, independent of the injected menus.
browser.composeAction.onClicked.addListener(tab => {
    attachFromClipboard(tab);
});
for (let [id, contexts] of [
    ["attach_clipboard_attachments", ["compose_attachments"]],
    ["attach_clipboard_tools", ["tools_menu"]],
]) {
    try {
        browser.menus.create({
            id,
            title: browser.i18n.getMessage("attachFromClipboard.label"),
            contexts,
        }, () => void browser.runtime.lastError);
    } catch (e) {
        console.error("Attach from Clipboard: could not create menu", id, e);
    }
}
browser.menus.onClicked.addListener((info, tab) => {
    if (info.menuItemId.startsWith("attach_clipboard_") && tab) {
        attachFromClipboard(tab);
    }
});
browser.windows.onCreated.addListener(window => {
    if (window.type == "messageCompose") {
        injectMenu(window.id);
    }
});

let windows = await browser.windows.getAll({ windowTypes: ["messageCompose"] });
for (let window of windows) {
    await injectMenu(window.id);
}
