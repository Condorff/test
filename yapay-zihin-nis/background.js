// Side panel açılış davranışını ayarla — toolbar ikonuna tıklayınca panel açılır
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);
