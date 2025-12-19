// pages/gerenzhongxin/gerenzhongxin.js
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    userInfo: {
      nickname: '',
      avatar_file_id: '',
      is_certified: false,
      certified_title: '',
      stats: {
        following: 0,
        followers: 0,
        likes: 0,
        views: 0
      }
    },
    viewsFormatted: '0',
    orderCounts: {
      pending: 0,
      toShip: 0,
      toReceive: 0,
      completed: 0,
      refund: 0
    },
    userPosts: [],
    leftPosts: [],
    rightPosts: [],
    activeTab: 0,
    currentUserId: 'user_master_001'
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.loadUserData()
  },

  /**
   * 加载用户数据
   */
  async loadUserData() {
    try {
      // 1. 获取用户信息
      const userRes = await db.collection('users')
        .doc(this.data.currentUserId)
        .get()

      if (userRes.data) {
        const views = userRes.data.stats ? userRes.data.stats.views : 0
        this.setData({
          userInfo: userRes.data,
          viewsFormatted: this.formatNumber(views)
        })
        console.log('用户信息:', userRes.data)
      }

      // 2. 获取订单统计
      await this.loadOrderCounts()

      // 3. 获取用户笔记
      await this.loadUserPosts()

    } catch (err) {
      console.error('加载用户数据失败:', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  /**
   * 加载订单统计
   */
  async loadOrderCounts() {
    try {
      const ordersRes = await db.collection('orders')
        .where({
          _openid: 'openid_master'
        })
        .get()

      const orders = ordersRes.data || []
      
      const orderCounts = {
        pending: orders.filter(o => o.status === 0).length,
        toShip: orders.filter(o => o.status === 1).length,
        toReceive: orders.filter(o => o.status === 2).length,
        completed: orders.filter(o => o.status === 3).length,
        refund: orders.filter(o => o.status === 4).length
      }

      this.setData({ orderCounts })
      console.log('订单统计:', orderCounts)

    } catch (err) {
      console.error('加载订单统计失败:', err)
    }
  },

  /**
   * 加载用户笔记
   */
  async loadUserPosts() {
    try {
      const postsRes = await db.collection('community_posts')
        .where({
          author_id: this.data.currentUserId
        })
        .orderBy('create_time', 'desc')
        .get()

      const userPosts = postsRes.data || []
      
      const leftPosts = []
      const rightPosts = []
      
      userPosts.forEach((item, index) => {
        if (index % 2 === 0) {
          leftPosts.push(item)
        } else {
          rightPosts.push(item)
        }
      })

      this.setData({
        userPosts,
        leftPosts,
        rightPosts
      })

      console.log('用户笔记:', userPosts)

    } catch (err) {
      console.error('加载用户笔记失败:', err)
    }
  },

  /**
   * 格式化大数字
   */
  formatNumber(num) {
    if (!num) return '0'
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + 'w'
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k'
    }
    return String(num)
  },

  /**
   * Tab 切换
   */
  onTabChange(e) {
    this.setData({
      activeTab: e.detail.index
    })
  },

  /**
   * 跳转到帖子详情
   */
  goToPostDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/community/detail?id=${id}`
    })
  },

  /**
   * 跳转到订单列表
   */
  goToOrders(e) {
    const status = e.currentTarget.dataset.status
    wx.showToast({
      title: '订单功能开发中',
      icon: 'none'
    })
  },

  /**
   * 跳转到全部订单
   */
  goToAllOrders() {
    wx.showToast({
      title: '订单功能开发中',
      icon: 'none'
    })
  },

  /**
   * 跳转到收货地址
   */
  goToAddress() {
    wx.showToast({
      title: '地址管理开发中',
      icon: 'none'
    })
  },

  /**
   * 跳转到认证页面
   */
  goToCertify() {
    wx.showToast({
      title: '认证功能开发中',
      icon: 'none'
    })
  },

  /**
   * 跳转到非遗足迹
   */
  goToFootprint() {
    wx.showToast({
      title: '足迹功能开发中',
      icon: 'none'
    })
  },

  /**
   * 联系客服
   */
  contactService() {
    wx.showToast({
      title: '客服功能开发中',
      icon: 'none'
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
    this.loadUserData().then(() => {
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

