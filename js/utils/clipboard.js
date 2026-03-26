// ========== КОПИРОВАНИЕ В БУФЕР ОБМЕНА ==========

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    console.log('[COPY] Успешно через execCommand');
    alert('Скрипт скопирован в буфер обмена');
  } catch (err) {
    console.error('[COPY] Fallback failed:', err);
    alert('Не удалось скопировать текст. Выделите его вручную.');
  }
  document.body.removeChild(textarea);
}

export function copyToClipboard(text) {
  console.log('[COPY] Попытка скопировать текст, длина:', text.length);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      console.log('[COPY] Успешно через Clipboard API');
    }).catch(err => {
      console.warn('[COPY] Clipboard API failed:', err);
      fallbackCopy(text);
    });
  } else {
    console.log('[COPY] Clipboard API не доступен, используем fallback');
    fallbackCopy(text);
  }
}
