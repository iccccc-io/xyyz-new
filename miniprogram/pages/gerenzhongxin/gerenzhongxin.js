// pages/gerenzhongxin/gerenzhongxin.js
const app = getApp()
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 是否已登录
    isLoggedIn: false,
    // 用户信息
    userInfo: {
      nickname: '',
      avatar_url: '',
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
    activeTab: 0
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.checkLoginStatus()
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 每次显示页面时检查登录状态（可能从登录页返回）
    this.checkLoginStatus()
  },

  /**
   * 检查登录状态
   */
  checkLoginStatus() {
    const userInfo = app.globalData.userInfo
    
    if (userInfo) {
      // 已登录
      this.setData({
        isLoggedIn: true,
        userInfo: {
          ...this.data.userInfo,
          ...userInfo,
          stats: userInfo.stats || this.data.userInfo.stats
        },
        viewsFormatted: this.formatNumber(userInfo.stats ? userInfo.stats.views : 0)
      })
      
      // 加载用户相关数据
      this.loadOrderCounts()
      this.loadUserPosts()
    } else {
      // 未登录，显示游客蒙版
      this.setData({
        isLoggedIn: false
      })
      
      // 设置回调，登录成功后刷新
      app.userInfoReadyCallback = (userInfo) => {
        this.checkLoginStatus()
      }
    }
  },

  /**
   * 跳转到登录页
   */
  goToLogin() {
    wx.navigateTo({
      url: '/pages/login/login'
    })
  },

  /**
   * 加载订单统计
   */
  async loadOrderCounts() {
    if (!app.globalData.openid) return
    
    try {
      const ordersRes = await db.collection('orders')
        .where({
          _openid: app.globalData.openid
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
    if (!app.globalData.userInfo) return
    
    try {
      const postsRes = await db.collection('community_posts')
        .where({
          _openid: app.globalData.openid
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
   * 退出登录
   */
  onLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      confirmColor: '#8B2E2A',
      success: (res) => {
        if (res.confirm) {
          app.logout()
          this.setData({
            isLoggedIn: false,
            userInfo: {
              nickname: '',
              avatar_url: '',
              is_certified: false,
              certified_title: '',
              stats: {
                following: 0,
                followers: 0,
                likes: 0,
                views: 0
              }
            },
            orderCounts: {
              pending: 0,
              toShip: 0,
              toReceive: 0,
              completed: 0,
              refund: 0
            },
            userPosts: [],
            leftPosts: [],
            rightPosts: []
          })
        }
      }
    })
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

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
    this.checkLoginStatus()
    wx.stopPullDownRefresh()
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
