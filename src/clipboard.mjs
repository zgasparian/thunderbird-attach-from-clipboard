const TYPES = [
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/png",
    "image/gif", // not supported by canvas.toDataUrl(), will be a png in a gif
    "text/html",
    "text/unicode",
    "text/plain"
];

function getFileName(type, index = 1) {
    const suffix = `_${index}`;
    switch (type) {
        case "image/png":
            return `document${suffix}.png`;
        case "image/jpeg":
        case "image/jpg":
            return `document${suffix}.jpg`;
        case "image/webp":
            return `document${suffix}.webp`;
        case "image/gif":
            return `document${suffix}.gif`;
        case "text/html":
            return `document${suffix}.html`;
        case "text/unicode":
        case "text/plain":
        default:
            return `document${suffix}.txt`;
    }
}

async function getSupportedTypes() {
    // Push the preferred type to the top and then filter the resulting array
    // by what the platform supports. If we are lucky, our preferred type is
    // supported directly. If not, we have to manually convert it later.
    let preferred_image_format = await getPreferredImageType();
    return [preferred_image_format, ...TYPES].filter(t => t && ClipboardItem.supports(t));
}

async function getPreferredImageType() {
    let { preferred_image_format } = await browser.storage.local.get(
        { preferred_image_format: null }
    );
    return preferred_image_format;
}

async function getPreferredSupportedType(types) {
    let flavours = await getSupportedTypes();
    let indices = types.map(type => flavours.indexOf(type)).filter(i => i !== -1);
    if (indices.length === 0) {
        // None of the supported types is preferred, return the first supported one.
        return types[0];
    }
    // Use numeric sort to find the lowest (most preferred) index.
    indices.sort((a, b) => a - b);
    return flavours[indices[0]];
}

const lastDiag = {};

export function getDiagnostics() {
    return JSON.stringify(lastDiag);
}

// Read files (e.g. copied in a file manager) from the clipboard. The async
// clipboard API does not expose these, but a synthetic paste does.
function readPastedFiles() {
    const box = document.createElement("div");
    box.contentEditable = "true";
    document.body.appendChild(box);
    const files = [];
    const onPaste = event => {
        lastDiag.pasteTypes = Array.from(event.clipboardData?.types ?? []);
        lastDiag.pasteFiles = event.clipboardData?.files?.length ?? 0;
        for (const file of event.clipboardData?.files ?? []) {
            files.push(file);
        }
    };
    box.addEventListener("paste", onPaste);
    try {
        box.focus();
        document.execCommand("paste");
    } catch (e) {
        lastDiag.pasteError = String(e);
        console.warn("Attach from Clipboard: paste fallback failed", e);
    } finally {
        box.removeEventListener("paste", onPaste);
        box.remove();
    }
    return files;
}

async function readClipboardItems() {
    try {
        const items = await navigator.clipboard.read(
            { unsanitized: await getSupportedTypes() }
        );
        lastDiag.readTypes = items.map(i => i.types);
        return items;
    } catch (e) {
        lastDiag.readError = String(e);
        console.warn("Attach from Clipboard: unsanitized read failed, retrying", e);
        try {
            const items = await navigator.clipboard.read();
            lastDiag.plainReadTypes = items.map(i => i.types);
            return items;
        } catch (e2) {
            lastDiag.plainReadError = String(e2);
            console.warn("Attach from Clipboard: clipboard.read failed", e2);
            return [];
        }
    }
}

async function pasteViaPopup() {
    const result = new Promise(resolve => {
        const listener = msg => {
            if (msg?.type == "paste-result") {
                browser.runtime.onMessage.removeListener(listener);
                resolve(msg.reply);
            }
        };
        browser.runtime.onMessage.addListener(listener);
        setTimeout(() => {
            browser.runtime.onMessage.removeListener(listener);
            resolve({ files: [], types: [], error: "timeout" });
        }, 5000);
    });
    let win;
    try {
        win = await browser.windows.create({
            url: browser.runtime.getURL("paste.html"),
            type: "popup", width: 200, height: 100,
        });
    } catch (e) {
        return { files: [], types: [], error: String(e) };
    }
    const reply = await result;
    try { await browser.windows.remove(win.id); } catch (e) { /* already closed */ }
    return reply;
}

// Collect everything attachable on the clipboard without attaching it.
async function collectCandidates(tab) {
    const candidates = [];
    const add = (label, file) => {
        if (file && file.size > 0) {
            candidates.push({ label, file });
        }
    };
    // Number new files after the ones already attached so names don't collide.
    let index = (await browser.compose.listAttachments(tab.id)).length + 1;

    // Files copied in a GNOME-style file manager only offer the
    // x-special/gnome-copied-files flavour, which web APIs cannot read.
    try {
        const { files, diag } = await browser.AttachMenu.readCopiedFiles(tab.windowId);
        lastDiag.copiedDiag = diag;
        for (const { name, base64 } of files) {
            const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
            add(`File: ${name}`, new File([bytes], name));
        }
    } catch (e) {
        lastDiag.copiedFilesError = String(e);
    }

    if (candidates.length > 0) {
        return candidates;
    }

    const pasted = await pasteViaPopup();
    lastDiag.popup = { ...pasted, files: pasted.files.length };
    for (const file of pasted.files) {
        add(`File: ${file.name}`, file);
    }

    try {
        for (const clipboardItem of await readClipboardItems()) {
            const type = await getPreferredSupportedType(clipboardItem.types);
            const blob = await clipboardItem.getType(type);
            let file = new File([blob], getFileName(type, index), { type });
            if (file.size > 0 && type.startsWith("image/")) {
                const preferred = await getPreferredImageType();
                if (preferred && preferred != type) {
                    file = await convertFileToType(file, preferred, index);
                }
            }
            add(`${type.startsWith("image/") ? "Image" : "Text"}: ${file.name}`, file);
            index++;
        }
    } catch (e) {
        lastDiag.itemsError = String(e);
    }

    if (candidates.length == 0 && (pasted.text || pasted.readText)) {
        const text = pasted.text || pasted.readText;
        add(`Text: ${getFileName("text/plain", index)}`,
            new File([text], getFileName("text/plain", index), { type: "text/plain" }));
    }
    return candidates;
}

// Show the clipboard contents in a small window and attach the chosen items.
async function showChooser(tab, candidates) {
    const listener = msg => {
        if (msg?.type == "chooser-init") {
            return Promise.resolve({
                items: candidates.map((c, id) => ({ id, label: c.label, size: c.file.size })),
                version: browser.runtime.getManifest().version,
                diag: (candidates.length == 0 || lastDiag.copiedDiag?.fileErrors?.length)
                    ? getDiagnostics() : "",
            });
        }
        if (msg?.type == "chooser-attach") {
            return (async () => {
                for (const id of msg.ids) {
                    await browser.compose.addAttachment(tab.id, { file: candidates[id].file });
                }
                return true;
            })();
        }
    };
    browser.runtime.onMessage.addListener(listener);
    const win = await browser.windows.create({
        url: browser.runtime.getURL("chooser.html"),
        type: "popup", width: 460, height: 360,
    });
    await new Promise(resolve => {
        const onRemoved = id => {
            if (id == win.id) {
                browser.windows.onRemoved.removeListener(onRemoved);
                resolve();
            }
        };
        browser.windows.onRemoved.addListener(onRemoved);
    });
    browser.runtime.onMessage.removeListener(listener);
}

export async function insertFromClipboard(tab) {
    if (tab.type != "messageCompose") {
        return;
    }
    const candidates = await collectCandidates(tab);
    if (candidates.length > 0 && !lastDiag.copiedDiag?.fileErrors?.length) {
        // Everything readable: attach directly, no window.
        for (const { file } of candidates) {
            await browser.compose.addAttachment(tab.id, { file });
        }
        return;
    }
    // Nothing found or some files failed: show the window with the details.
    await showChooser(tab, candidates);
};

// --- Inspired by https://gist.github.com/mikey0000/5a078346f58713d0075f

function convertDataUrlToArrayBuffer(dataUrl) {
    var BASE64_MARKER = ';base64,';
    var base64Index = dataUrl.indexOf(BASE64_MARKER) + BASE64_MARKER.length;
    var base64 = dataUrl.substring(base64Index);
    var raw = window.atob(base64);
    var rawLength = raw.length;
    var array = new Uint8Array(new ArrayBuffer(rawLength));

    for (let i = 0; i < rawLength; i++) {
        array[i] = raw.charCodeAt(i);
    }
    return array;
}

async function loadImage(objectURL) {
    let done = Promise.withResolvers();
    let image = document.createElement("img");
    image.onload = function () {
        // https://bugzilla.mozilla.org/show_bug.cgi?id=574330#c54
        if (!image.complete) {
            image.src = image.src; // eslint-disable-line no-self-assign
            return;
        }
        done.resolve(image);
    };
    image.onerror = function () {
        done.reject();
    };
    image.src = objectURL;
    return done.promise;
}

async function convertFileToType(file, type, index = 0) {
    let objectURL = URL.createObjectURL(file)
    let image = await loadImage(objectURL);

    var canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d").drawImage(image, 0, 0);

    // The image/jpg type is actually image/jpeg an the canvas will return png,
    // if the "unknown" type image/jpg is used.
    if (type == "image/jpg") { type = "image/jpeg" };

    const dataUrl = canvas.toDataURL(type);
    const arrayBuffer = convertDataUrlToArrayBuffer(dataUrl);
    URL.revokeObjectURL(objectURL);
    return new File([arrayBuffer], getFileName(type, index), { type });
};
