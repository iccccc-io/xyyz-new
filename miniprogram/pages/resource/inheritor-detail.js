// pages/resource/inheritor-detail.js
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    inheritorId: '',
    inheritorData: null,
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
      inheritorId: options.id
    })

    await this.loadInheritorDetail()
  },

  /**
   * 加载传承人详情
   */
  async loadInheritorDetail() {
    this.setData({ loading: true })

    try {
      // 查询传承人信息
      const inheritorRes = await db.collection('ich_inheritors')
        .doc(this.data.inheritorId)
        .get()

      if (!inheritorRes.data) {
        this.setData({ loading: false })
        wx.showToast({
          title: '传承人不存在',
          icon: 'none'
        })
        return
      }

      this.setData({
        inheritorData: inheritorRes.data,
        loading: false
      })

      console.log('传承人详情:', inheritorRes.data)

    } catch (err) {
      console.error('加载传承人详情失败:', err)
      this.setData({ loading: false })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  /**
   * 跳转到项目详情
   */
  goToProject() {
    if (!this.data.inheritorData.project_id) {
      wx.showToast({
        title: '项目信息不存在',
        icon: 'none'
      })
      return
    }
    
    wx.navigateTo({
      url: `/pages/resource/project-detail?id=${this.data.inheritorData.project_id}`
    })
  },

  /**
   * 预览图片
   */
  previewImage(e) {
    const url = e.currentTarget.dataset.url
    const imageUrls = this.data.inheritorData.media_list
      .filter(item => item.type === 'image')
      .map(item => item.url)
    
    wx.previewImage({
      current: url,
      urls: imageUrls
    })
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

