// content.js
// Main entry point for the GemiBoost content script

console.log("GemiBoost (Table of Contents) Content Script Initialized");

// Ensure the page is somewhat loaded before starting
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    Catalog.init();
  });
} else {
  Catalog.init();
}
