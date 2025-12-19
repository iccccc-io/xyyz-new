// pages/resource/project-detail.js
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    projectId: '',
    projectData: null,
    inheritorData: null,
    newsList: [],
    loading: true
  },

  /**
   * 生命周期函数--监听页面加载
   */
  async onLoad(options) {
    if (!options.id) {
      wx.showToast({
        title: '参数错误',
        icon: 'none'
      })
      return
    }

    this.setData({
      projectId: options.id
    })

    await this.loadProjectDetail()
  },

  /**
   * 加载项目详情
   */
  async loadProjectDetail() {
    this.setData({ loading: true })

    try {
      // 1. 查询项目基本信息
      const projectRes = await db.collection('ich_projects')
        .doc(this.data.projectId)
        .get()

      if (!projectRes.data) {
        this.setData({ loading: false })
        wx.showToast({
          title: '项目不存在',
          icon: 'none'
        })
        return
      }

      const projectData = projectRes.data
      this.setData({ projectData })

      // 2. 如果有关联传承人，查询传承人信息
      if (projectData.inheritor_id) {
        try {
          const inheritorRes = await db.collection('ich_inheritors')
            .doc(projectData.inheritor_id)
            .get()
          
          if (inheritorRes.data) {
            this.setData({
              inheritorData: inheritorRes.data
            })
          }
        } catch (err) {
          console.warn('查询传承人信息失败:', err)
        }
      }

      // 3. 如果有相关资讯，查询资讯列表
      if (projectData.related_news_ids && projectData.related_news_ids.length > 0) {
        try {
          const newsRes = await db.collection('ich_news')
            .where({
              _id: db.command.in(projectData.related_news_ids)
            })
            .get()
          
          if (newsRes.data && newsRes.data.length > 0) {
            // 格式化日期
            const newsList = newsRes.data.map(item => ({
              ...item,
              publish_date: this.formatDate(item.publish_date)
            }))
            
            this.setData({ newsList })
          }
        } catch (err) {
          console.warn('查询相关资讯失败:', err)
        }
      }

      this.setData({ loading: false })

    } catch (err) {
      console.error('加载项目详情失败:', err)
      this.setData({ loading: false })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  /**
   * 格式化日期
   */
  formatDate(date) {
    if (!date) return ''
    
    const d = new Date(date)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    
    return `${year}-${month}-${day}`
  },

  /**
   * 跳转到传承人详情
   */
  goToInheritor() {
    if (!this.data.projectData.inheritor_id) return
    
    wx.navigateTo({
      url: `/pages/resource/inheritor-detail?id=${this.data.projectData.inheritor_id}`
    })
  },

  /**
   * 预览图片
   */
  previewImage(e) {
    const url = e.currentTarget.dataset.url
    const imageUrls = this.data.projectData.media_list
      .filter(item => item.type === 'image')
      .map(item => item.url)
    
    wx.previewImage({
      current: url,
      urls: imageUrls
    })
  },

  /**
   * 跳转到资讯详情（暂未开发，用 toast 占位）
   */
  goToNews(e) {
    const newsId = e.currentTarget.dataset.id
    
    // TODO: 待资讯详情页开发完成后，修改为真实跳转
    wx.showToast({
      title: '资讯详情页开发中',
      icon: 'none'
    })
    
    // wx.navigateTo({
    //   url: `/pages/news/detail?id=${newsId}`
    // })
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})

