async function openWorkspace() {
  return chrome.windows.create({
    url: chrome.runtime.getURL("index.html"),
    type: "popup",
    width: 1500,
    height: 920,
    focused: true
  });
}

chrome.action.onClicked.addListener(openWorkspace);
