const list = document.getElementById("list");
const attach = document.getElementById("attach");
const info = await browser.runtime.sendMessage({ type: "chooser-init" });
document.getElementById("title").textContent =
    `Clipboard contents (v${info.version})`;
for (const item of info.items) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.dataset.id = item.id;
    label.append(box, ` ${item.label} `);
    const size = document.createElement("small");
    size.textContent = `(${Math.ceil(item.size / 1024)} KB)`;
    label.append(size);
    list.append(label);
}
if (info.items.length == 0) {
    document.getElementById("empty").hidden = false;
    attach.disabled = true;
}
document.getElementById("diag").textContent = info.diag;
attach.addEventListener("click", async () => {
    const ids = Array.from(list.querySelectorAll("input:checked"), b => Number(b.dataset.id));
    await browser.runtime.sendMessage({ type: "chooser-attach", ids });
    window.close();
});
document.getElementById("cancel").addEventListener("click", () => window.close());
