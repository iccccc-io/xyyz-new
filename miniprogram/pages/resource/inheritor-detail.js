const db = wx.cloud.database()

const LEVEL_FULL_TEXT = {
  '国家级': '国家级代表性传承人',
  '省级': '省级代表性传承人',
  '市级': '市级代表性传承人',
  '县级': '县级代表性传承人'
}

Page({
  data: {
    inheritorId: '',
    inheritorData: null,
    levelFullText: '',
    newsList: [],
    loading: true,
    showNavTitle: false
  },

  onLoad(options) {
    if (!options.id) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    this.setData({ inheritorId: options.id })
    this.loadDetail()
  },

  async loadDetail() {
    this.setData({ loading: true })
    try {
      const res = await db.collection('ich_inheritors')
        .where({ inheritor_id: this.data.inheritorId })
        .limit(1)
        .get()

      if (!res.data || res.data.length === 0) {
        this.setData({ loading: false })
        wx.showToast({ title: '传承人不存在', icon: 'none' })
        return
      }

      const inheritorData = res.data[0]
      if (inheritorData.content) {
        inheritorData._processedContent = this.processHtml(inheritorData.content)
      }

      const levelFullText = LEVEL_FULL_TEXT[inheritorData.level] || inheritorData.level || ''

      this.setData({ inheritorData, levelFullText, loading: false })

      this.loadRelatedNews()
    } catch (err) {
      console.error('加载传承人详情失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async loadRelatedNews() {
    try {
      const res = await db.collection('ich_news')
        .where({ 'related_inheritors.inheritor_id': this.data.inheritorId })
        .limit(10)
        .get()
      if (res.data && res.data.length > 0) {
        this.setData({ newsList: res.data })
      }
    } catch (err) {
      console.warn('查询关联资讯失败:', err)
    }
  },

  processHtml(html) {
    if (!html) return ''
    return html
      .replace(/http:\/\//gi, 'https://')
      .replace(/<img/gi, '<img style="max-width:100%;height:auto;display:block;margin:10px auto;"')
      .replace(/<table/gi, '<table style="max-width:100%;border-collapse:collapse;font-size:14px;"')
  },

  goToProject() {
    const worksAt = this.data.inheritorData && this.data.inheritorData.works_at
    if (!worksAt || !worksAt.project_id) {
      wx.showToast({ title: '暂无关联项目', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/resource/project-detail?id=${worksAt.project_id}`
    })
  },

  goToNews(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/resource/news-detail?id=${id}` })
  },

  onPageScroll(e) {
    const show = e.scrollTop > 200
    if (show !== this.data.showNavTitle) {
      this.setData({ showNavTitle: show })
    }
  },

  previewAvatar() {
    if (this.data.inheritorData && this.data.inheritorData.cover) {
      wx.previewImage({
        current: this.data.inheritorData.cover,
        urls: [this.data.inheritorData.cover]
      })
    }
  },

  goToAiChat() {
    const { inheritorData, inheritorId } = this.data
    if (!inheritorData) return
    wx.navigateTo({
      url: `/pages/ai-chat/index?source_scene=ich_inheritor&source_entity_name=${encodeURIComponent(inheritorData.name)}&source_entity_id=${inheritorId}`
    })
  },

  onShareAppMessage() {
    const d = this.data.inheritorData
    return {
      title: d ? `${d.name} - 非遗传承人` : '非遗传承人详情',
      path: `/pages/resource/inheritor-detail?id=${this.data.inheritorId}`
    }
  }
})
