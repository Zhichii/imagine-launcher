// About Page Script
const fs = require('fs');
const path = require('path');

let i18nData = {};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function init() {
  loadI18n();
}

async function loadI18n() {
  try {
    const i18nPath = path.join(__dirname, '../../locales/zh-CN.json');
    const data = fs.readFileSync(i18nPath, 'utf8');
    i18nData = JSON.parse(data);
    applyI18n();
  } catch (error) {
    console.error('Failed to load i18n:', error);
  }
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const value = getI18n(key);
    if (value) el.textContent = value;
  });
}

function getI18n(key) {
  return key.split('.').reduce((obj, k) => obj?.[k], i18nData);
}
