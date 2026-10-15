// Runs in a focused popup so a real paste event with clipboardData.files fires.
const box = document.getElementById("box");
let reply = { files: [], types: [], error: null, fired: false };
box.addEventListener("paste", event => {
    reply.fired = true;
    const cd = event.clipboardData;
    reply.types = Array.from(cd?.types ?? []);
    reply.files = Array.from(cd?.files ?? []).filter(f => f.size > 0);
    reply.uriList = cd?.getData("text/uri-list") || "";
    reply.text = (cd?.getData("text/plain") || "").slice(0, 200);
    event.preventDefault();
});
window.addEventListener("load", async () => {
    window.focus();
    box.focus();
    try {
        document.execCommand("paste");
    } catch (e) {
        reply.error = String(e);
    }
    reply.focused = document.hasFocus();
    try {
        const items = await navigator.clipboard.read();
        reply.apiTypes = items.map(i => i.types);
    } catch (e) {
        reply.apiError = String(e);
    }
    try {
        reply.readText = (await navigator.clipboard.readText()).slice(0, 80);
    } catch (e) {
        reply.readTextError = String(e);
    }
    await browser.runtime.sendMessage({ type: "paste-result", reply });
    window.close();
});
