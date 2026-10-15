/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";

// Using a closure to not leak anything but the API to the outside world.
(function (exports) {
  // Helper function to inject a legacy XUL string into the DOM of Thunderbird.
  // All injected elements will get the data attribute "data-extension-injected"
  // set to the extension id, for easy removal.
  const injectElements = function (extension, window, xulString, debug = false) {
    function checkElements(stringOfIDs) {
      let arrayOfIDs = stringOfIDs.split(",").map((e) => e.trim());
      for (let id of arrayOfIDs) {
        let element = window.document.getElementById(id);
        if (element) {
          return element;
        }
      }
      return null;
    }

    function localize(entity) {
      let msg = entity.slice("__MSG_".length, -2);
      return extension.localeData.localizeMessage(msg);
    }

    function injectChildren(elements, container) {
      if (debug) console.log(elements);

      for (let i = 0; i < elements.length; i++) {
        if (
          elements[i].hasAttribute("insertafter") &&
          checkElements(elements[i].getAttribute("insertafter"))
        ) {
          let insertAfterElement = checkElements(
            elements[i].getAttribute("insertafter")
          );

          if (debug)
            console.log(
              elements[i].tagName +
              "#" +
              elements[i].id +
              ": insertafter " +
              insertAfterElement.id
            );
          if (
            debug &&
            elements[i].id &&
            window.document.getElementById(elements[i].id)
          ) {
            console.error(
              "The id <" +
              elements[i].id +
              "> of the injected element already exists in the document!"
            );
          }
          elements[i].setAttribute("data-extension-injected", extension.id);
          insertAfterElement.parentNode.insertBefore(
            elements[i],
            insertAfterElement.nextSibling
          );
        } else if (
          elements[i].hasAttribute("insertbefore") &&
          checkElements(elements[i].getAttribute("insertbefore"))
        ) {
          let insertBeforeElement = checkElements(
            elements[i].getAttribute("insertbefore")
          );

          if (debug)
            console.log(
              elements[i].tagName +
              "#" +
              elements[i].id +
              ": insertbefore " +
              insertBeforeElement.id
            );
          if (
            debug &&
            elements[i].id &&
            window.document.getElementById(elements[i].id)
          ) {
            console.error(
              "The id <" +
              elements[i].id +
              "> of the injected element already exists in the document!"
            );
          }
          elements[i].setAttribute("data-extension-injected", extension.id);
          insertBeforeElement.parentNode.insertBefore(
            elements[i],
            insertBeforeElement
          );
        } else if (
          elements[i].id &&
          window.document.getElementById(elements[i].id)
        ) {
          // existing container match, dive into recursively
          if (debug)
            console.log(
              elements[i].tagName +
              "#" +
              elements[i].id +
              " is an existing container, injecting into " +
              elements[i].id
            );
          injectChildren(
            Array.from(elements[i].children),
            window.document.getElementById(elements[i].id)
          );
        } else {
          // append element to the current container
          if (debug)
            console.log(
              elements[i].tagName +
              "#" +
              elements[i].id +
              ": append to " +
              container.id
            );
          elements[i].setAttribute("data-extension-injected", extension.id);
          container.appendChild(elements[i]);
        }
      }
    }

    if (debug) console.log("Injecting into root document:");
    let localizedXulString = xulString.replace(
      /__MSG_(.*?)__/g,
      localize
    );
    injectChildren(
      Array.from(
        window.MozXULElement.parseXULToFragment(localizedXulString, []).children
      ),
      window.document.documentElement
    );
  };

  const COMPOSE_URI = "chrome://messenger/content/messengercompose/messengercompose.xhtml";

  // windows.onCreated can fire before the compose document has been loaded,
  // in which case none of the menus exist yet. Wait until they do.
  async function waitForComposeWindow(window) {
    for (let i = 0; i < 200; i++) {
      let doc = window.document;
      if (
        window.location.href == COMPOSE_URI &&
        doc.readyState == "complete" &&
        doc.getElementById("menu_AttachPopup") &&
        doc.getElementById("button-attachPopup")
      ) {
        return;
      }
      await new Promise(resolve => window.setTimeout(resolve, 50));
    }
    throw new Error("Compose window did not finish loading");
  }

  const emitter = new ExtensionCommon.EventEmitter();

  var AttachMenu = class extends ExtensionCommon.ExtensionAPI {
    getAPI(context) {
          async function readCopiedFilesImpl(windowId) {
            const FLAVOR = "x-special/gnome-copied-files";
            let { window } = context.extension.windowManager.get(windowId);
            const trans = Cc["@mozilla.org/widget/transferable;1"]
              .createInstance(Ci.nsITransferable);
            trans.init(null);
            trans.addDataFlavor(FLAVOR);
            Services.clipboard.getData(trans, Ci.nsIClipboard.kGlobalClipboard,
              window.browsingContext?.currentWindowContext ?? null);
            let data = {};
            let transferError = null;
            try {
              trans.getTransferData(FLAVOR, data);
            } catch (e) {
              transferError = String(e);
            }
            let value = data.value;
            let text = "";
            if (value instanceof Ci.nsISupportsString) {
              text = value.data;
            } else if (value instanceof Ci.nsISupportsCString) {
              text = value.data;
            } else if (value instanceof Ci.nsIInputStream) {
              let bin = Cc["@mozilla.org/binaryinputstream;1"]
                .createInstance(Ci.nsIBinaryInputStream);
              bin.setInputStream(value);
              text = new window.TextDecoder().decode(
                new Uint8Array(bin.readByteArray(bin.available())));
            }
            // Unknown flavours arrive as raw bytes that may have been
            // decoded as UTF-16. Parse both the text as-is and the text
            // rebuilt from its bytes (as UTF-8) and use whichever has
            // more file:// lines.
            const fileLines = t => t.replace(/\0/g, "").split(/\r?\n/)
              .map(l => l.trim()).filter(l => l.startsWith("file://"));
            if (text) {
              let bytes = [];
              for (let i = 0; i < text.length; i++) {
                let c = text.charCodeAt(i);
                bytes.push(c & 0xff, c >> 8);
              }
              let decoded = new window.TextDecoder().decode(new Uint8Array(bytes));
              if (fileLines(decoded).length > fileLines(text).length) {
                text = decoded;
              }
            }
            let diag = {
              lineCount: fileLines(text).length,
              valueType: value ? Object.prototype.toString.call(value) : null,
              textLength: text.length,
              transferError,
            };
            try {
              diag.hasFlavor = Services.clipboard.hasDataMatchingFlavors(
                [FLAVOR], Ci.nsIClipboard.kGlobalClipboard);
            } catch (e) {
              diag.hasFlavorError = String(e);
            }
            try {
              diag.available = Services.clipboard.getAvailableClipboardTypes
                ? Array.from(Services.clipboard.getAvailableClipboardTypes(
                    Ci.nsIClipboard.kGlobalClipboard))
                : "n/a";
            } catch (e) {
              diag.availableError = String(e);
            }
            // Only attach files below the user's home folder (also the real
            // home when running as a snap) and never from hidden folders such
            // as ~/.ssh or ~/.gnupg, so a hostile clipboard cannot pull in
            // secrets.
            let homes = [];
            try {
              let home = Services.dirsvc.get("Home", Ci.nsIFile).path;
              homes.push(home);
              let snapMatch = home.match(/^(\/home\/[^/]+)\/snap\//);
              if (snapMatch) {
                homes.push(snapMatch[1]);
              }
            } catch (e) {
              diag.homeError = String(e);
            }
            const isAllowed = path => {
              let parts = path.split("/");
              if (!path.startsWith("/") || parts.includes("..") || parts.includes(".")) {
                return false;
              }
              if (parts.some(part => part.startsWith("."))) {
                return false;
              }
              return homes.some(h => path.startsWith(h.replace(/\/$/, "") + "/"));
            };
            let result = [];
            diag.fileErrors = [];
            let seen = new Set();
            for (let line of fileLines(text)) {
              try {
                let path = decodeURIComponent(line.slice("file://".length));
                if (!isAllowed(path)) {
                  diag.fileErrors.push(path.split("/").pop() + " -> blocked (outside home folder or hidden path)");
                  continue;
                }
                let bytes = await (typeof IOUtils != "undefined" ? IOUtils : window.IOUtils).read(path);
                let base64 = "";
                for (let i = 0; i < bytes.length; i += 0x8000) {
                  base64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                }
                let name = path.split("/").pop();
                if (seen.has(name)) {
                  name = result.length + "_" + name;
                }
                seen.add(name);
                result.push({ name, base64: window.btoa(base64) });
              } catch (e) {
                diag.fileErrors.push(line.slice(-80) + " -> " + String(e).slice(0, 120));
              }
            }
            return { files: result, diag };
          }

      return {
        AttachMenu: {
          async inject(windowId) {
            // Get the native window belonging to the specified windowId.
            let { window } = context.extension.windowManager.get(windowId);

            await waitForComposeWindow(window);

            // Already injected into this window.
            if (window.document.getElementById("menu_AttachPopup_clipboard")) {
              return;
            }

            // Temporary Experiment until the proper context for the menus API has
            // been implemented.
            injectElements(context.extension, window, `
            <menupopup id="button-attachPopup">
              <menuitem id="button-attachPopup_clipboard" insertafter="button-attachPopup_attachPageItem"
                label="__MSG_attachFromClipboardAttachMenu.label__" accesskey="__MSG_attachFromClipboard.accesskey__" />
            </menupopup>
            <menupopup id="menu_AttachPopup">
              <menuitem id="menu_AttachPopup_clipboard"
                label="__MSG_attachFromClipboard.label__" accesskey="__MSG_attachFromClipboard.accesskey__" />
            </menupopup>
            <menupopup id="msgComposeAttachmentListContext">
              <menuitem id="msgComposeAttachmentListContext_clipboard" insertafter="attachmentListContext_attachPageItem"
                label="__MSG_attachFromClipboardContextMenu.label__" accesskey="__MSG_attachFromClipboard.accesskey__" />
            </menupopup>`);

            // Move entry to the correct location (best effort, keep the
            // entry where it was injected if the reference item is gone).
            let menu = window.document.getElementById("menu_AttachPopup");
            let fileMenuAttachPageEntry = menu && Array.from(menu.children).find(c => c.getAttribute("command") == "cmd_attachPage");
            let fileMenuAttachClipboardEntry = menu && menu.querySelector("#menu_AttachPopup_clipboard");
            if (fileMenuAttachPageEntry && fileMenuAttachClipboardEntry) {
              menu.insertBefore(fileMenuAttachClipboardEntry, fileMenuAttachPageEntry.nextSibling);
            }

            function eventHandler(e) {
              e.preventDefault();
              e.stopPropagation();
              emitter.emit("attach-menu-clicked", e.view);
            }

            // Add listeners to trigger the WebExtension events.
            for (let id of [
              "menu_AttachPopup_clipboard",
              "button-attachPopup_clipboard",
              "msgComposeAttachmentListContext_clipboard",
            ]) {
              window.document.getElementById(id)?.addEventListener("command", eventHandler);
            }

          },
          async readCopiedFiles(windowId) {
            // Never throw: errors from experiment APIs are masked as
            // "An unexpected error occurred", so report them in the result.
            try {
              return await readCopiedFilesImpl(windowId);
            } catch (e) {
              return { files: [], diag: { thrown: String(e), stack: String(e.stack).slice(0, 400) } };
            }
          },

          onClicked: new ExtensionCommon.EventManager({
            context,
            name: "AttachMenu.onClicked",
            register(fire) {
              const { extension } = context;
              const { tabManager, windowManager } = extension;

              function callback(event, window) {
                const win = windowManager.wrapWindow(window);
                const tab = tabManager.convert(win.activeTab.nativeTab);
                return fire.async(tab);
              }

              emitter.on("attach-menu-clicked", callback);
              return function () {
                emitter.off("attach-menu-clicked", callback);
              };
            },
          }).api(),
        },
      };
    }

    onShutdown(isAppShutdown) {
      if (isAppShutdown) {
        return; // the application gets unloaded anyway
      }

      const { extension } = this;
      for (const window of Services.wm.getEnumerator("msgcompose")) {
        if (window) {
          let elements = Array.from(
            window.document.querySelectorAll(
              '[data-extension-injected="' + extension.id + '"]'
            )
          );
          for (let element of elements) {
            element.remove();
          }
        }
      }
    }
  };
  exports.AttachMenu = AttachMenu;
})(this);