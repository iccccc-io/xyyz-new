// pages/webview/index.js
Page({
  data: {
    url: '',
    title: '网页'
  },

  onLoad(options) {
    const url = decodeURIComponent(options.url || '')
    const title = decodeURIComponent(options.title || '网页')
    this.setData({ url, title })
  },

  onError(e) {
    console.error('WebView 加载失败:', e)
    wx.showToast({ title: '页面加载失败', icon: 'none' })
  }
})
