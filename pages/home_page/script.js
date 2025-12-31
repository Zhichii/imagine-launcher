// Home Page Script
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
  initInteractions();
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

function initInteractions() {
  // 启动按钮
  document.getElementById('launch-btn')?.addEventListener('click', () => {
    notifyParent('launch-game');
  });

  // 快捷卡片
  document.querySelectorAll('.quick-card').forEach(card => {
    card.addEventListener('click', () => {
      const title = card.querySelector('.quick-title')?.textContent;
      console.log('Quick action:', title);
    });
  });

  // 实例播放
  document.querySelectorAll('.btn-play').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.closest('.instance-item')?.querySelector('.instance-name')?.textContent;
      notifyParent('launch-instance', { name });
    });
  });
}

function notifyParent(action, data = {}) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ action, ...data }, '*');
  }
}
