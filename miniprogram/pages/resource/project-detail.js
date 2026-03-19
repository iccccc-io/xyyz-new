const db = wx.cloud.database()

Page({
  data: {
    projectId: '',
    projectData: null,
    inheritorList: [],
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
    this.setData({ projectId: options.id })
    this.loadDetail()
  },

  async loadDetail() {
    this.setData({ loading: true })
    try {
      const projectRes = await db.collection('ich_projects')
        .where({ project_id: this.data.projectId })
        .limit(1)
        .get()

      if (!projectRes.data || projectRes.data.length === 0) {
        this.setData({ loading: false })
        wx.showToast({ title: '项目不存在', icon: 'none' })
        return
      }

      const projectData = projectRes.data[0]
      if (projectData.content) {
        projectData._processedContent = this.processHtml(projectData.content)
      }
      this.setData({ projectData })

      this.loadRelatedInheritors()
      this.loadRelatedNews()
      this.setData({ loading: false })
    } catch (err) {
      console.error('加载项目详情失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async loadRelatedInheritors() {
    try {
      const res = await db.collection('ich_inheritors')
        .where({ 'works_at.project_id': this.data.projectId })
        .get()
      if (res.data && res.data.length > 0) {
        this.setData({ inheritorList: res.data })
      }
    } catch (err) {
      console.warn('查询关联传承人失败:', err)
    }
  },

  async loadRelatedNews() {
    try {
      const res = await db.collection('ich_news')
        .where({ 'related_projects.project_id': this.data.projectId })
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

  goToInheritor(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/resource/inheritor-detail?id=${id}` })
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

  previewCover() {
    if (this.data.projectData && this.data.projectData.cover) {
      wx.previewImage({
        current: this.data.projectData.cover,
        urls: [this.data.projectData.cover]
      })
    }
  },

  goToAiChat() {
    const { projectData, projectId } = this.data
    if (!projectData) return
    wx.navigateTo({
      url: `/pages/ai-chat/index?source_type=project&source_name=${encodeURIComponent(projectData.name)}&source_id=${projectId}`
    })
  },

  onShareAppMessage() {
    const p = this.data.projectData
    return {
      title: p ? p.name : '非遗项目详情',
      path: `/pages/resource/project-detail?id=${this.data.projectId}`
    }
  }
})
