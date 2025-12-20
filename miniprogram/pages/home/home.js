// pages/home/home.js
Page({
  /**
   * 页面的初始数据
   */
  data: {

  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {

  },

  /**
   * 导航到非遗资源列表
   */
  navigateToResource() {
    wx.navigateTo({
      url: '/pages/resource/list'
    })
  },

  /**
   * 导航到非遗展馆列表
   */
  navigateToHall() {
    wx.navigateTo({
      url: '/pages/venue/list?type=hall'
    })
  },

  /**
   * 导航到非遗工坊列表
   */
  navigateToWorkshop() {
    wx.navigateTo({
      url: '/pages/venue/list?type=workshop'
    })
  },

  /**
   * 导航到非遗街区列表
   */
  navigateToStreet() {
    wx.navigateTo({
      url: '/pages/venue/list?type=street'
    })
  },

  /**
   * 导航到非遗社区
   */
  navigateToCommunity() {
    wx.navigateTo({
      url: '/pages/community/index'
    })
  },

  /**
   * 导航到文创商城
   */
  navigateToMall() {
    wx.navigateTo({
      url: '/pages/mall/home'
    })
  },

  /**
   * 导航到个人中心
   */
  navigateToUser() {
    wx.navigateTo({
      url: '/pages/gerenzhongxin/gerenzhongxin'
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

