/**
 * 跨环境安全复制工具
 *
 * navigator.clipboard.writeText 只在 HTTPS 或 localhost 下可用。
 * 局域网 HTTP（http://x.x.x.x:5173）访问时 navigator.clipboard === undefined。
 * 降级方案：创建隐藏 textarea，document.execCommand('copy')。
 */
export async function safeCopyText(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text)
  }
  // HTTP 降级：execCommand
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
  document.body.appendChild(el)
  el.focus()
  el.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(el)
  }
}
