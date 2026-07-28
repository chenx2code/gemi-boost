// content-utils.js
// Utility functions for GemiBoost

const Utils = {
    // Debounce function to limit how often a function can fire
    debounce: function (func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }
};
