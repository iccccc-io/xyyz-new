const db = wx.cloud.database()

Page({
  data: {
    newsId: '',
    newsData: null,
    loading: true,
    showNavTitle: false
  },

  onLoad(options) {
    if (!options.id) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    this.setData({ newsId: options.id })
    this.loadDetail()
  },

  async loadDetail() {
    this.setData({ loading: true })
    try {
      const res = await db.collection('ich_news')
        .where({ news_id: this.data.newsId })
        .limit(1)
        .get()

      if (!res.data || res.data.length === 0) {
        this.setData({ loading: false })
        wx.showToast({ title: '资讯不存在', icon: 'none' })
        return
      }

      const newsData = res.data[0]
      if (newsData.content_html) {
        newsData._processedContent = this.processHtml(newsData.content_html)
      }
      this.setData({ newsData, loading: false })
    } catch (err) {
      console.error('加载资讯详情失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  processHtml(html) {
    if (!html) return ''
    return html
      .replace(/http:\/\//gi, 'https://')
      .replace(/<img/gi, '<img style="max-width:100%;height:auto;display:block;margin:10px auto;"')
      .replace(/<table/gi, '<table style="max-width:100%;border-collapse:collapse;font-size:14px;"')
  },

  goToProject(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/resource/project-detail?id=${id}` })
  },

  goToInheritor(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/resource/inheritor-detail?id=${id}` })
  },

  onPageScroll(e) {
    const show = e.scrollTop > 100
    if (show !== this.data.showNavTitle) {
      this.setData({ showNavTitle: show })
    }
  },

  goToAiChat() {
    const { newsData, newsId } = this.data
    if (!newsData) return
    wx.navigateTo({
      url: `/pages/ai-chat/index?source_scene=ich_news&source_entity_name=${encodeURIComponent(newsData.title)}&source_entity_id=${newsId}`
    })
  },

  onShareAppMessage() {
    const d = this.data.newsData
    return {
      title: d ? d.title : '非遗资讯',
      path: `/pages/resource/news-detail?id=${this.data.newsId}`
    }
  }
})
