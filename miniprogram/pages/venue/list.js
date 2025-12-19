// pages/venue/list.js
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    venueType: '',      // 场所类型：hall/workshop/street
    typeName: '',       // 类型中文名
    venueList: [],      // 场所列表
    loading: true
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    if (!options.type) {
      wx.showToast({
        title: '参数错误',
        icon: 'none'
      })
      return
    }

    // 设置场所类型和标题
    const venueType = options.type
    const typeNameMap = {
      'hall': '非遗展馆',
      'workshop': '非遗工坊',
      'street': '非遗街区'
    }

    this.setData({
      venueType: venueType,
      typeName: typeNameMap[venueType] || '非遗场所'
    })

    // 动态设置导航栏标题
    wx.setNavigationBarTitle({
      title: typeNameMap[venueType] || '非遗场所'
    })

    // 加载数据
    this.loadVenueList()
  },

  /**
   * 加载场所列表
   */
  async loadVenueList() {
    this.setData({ loading: true })

    try {
      console.log('=== 查询场所列表 ===')
      console.log('场所类型:', this.data.venueType)

      const res = await db.collection('ich_venues')
        .where({
          type: this.data.venueType
        })
        .get()

      console.log('查询结果:', res.data)

      this.setData({
        venueList: res.data,
        loading: false
      })

      if (res.data.length === 0) {
        console.warn('暂无数据')
      }

    } catch (err) {
      console.error('加载场所列表失败:', err)
      this.setData({ loading: false })
      
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  /**
   * 跳转到详情页
   */
  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/venue/detail?id=${id}`
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
    this.loadVenueList().then(() => {
      wx.stopPullDownRefresh()
    })
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

