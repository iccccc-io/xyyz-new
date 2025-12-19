// pages/community/index.js
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    postList: [],      // 全部帖子
    leftColumn: [],    // 左列帖子
    rightColumn: [],   // 右列帖子
    loading: true
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.loadPosts()
  },

  /**
   * 加载帖子列表
   */
  async loadPosts() {
    this.setData({ loading: true })

    try {
      console.log('=== 加载社区帖子 ===')

      const res = await db.collection('community_posts')
        .orderBy('create_time', 'desc')
        .limit(50)
        .get()

      console.log('帖子数据:', res.data)

      const postList = res.data

      // 分配到左右两列（交替分配实现瀑布流效果）
      const leftColumn = []
      const rightColumn = []

      postList.forEach((item, index) => {
        if (index % 2 === 0) {
          leftColumn.push(item)
        } else {
          rightColumn.push(item)
        }
      })

      this.setData({
        postList,
        leftColumn,
        rightColumn,
        loading: false
      })

      if (postList.length === 0) {
        console.warn('暂无帖子数据')
      }

    } catch (err) {
      console.error('加载帖子失败:', err)
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
      url: `/pages/community/detail?id=${id}`
    })
  },

  /**
   * 跳转到发布页
   */
  goToPost() {
    wx.navigateTo({
      url: '/pages/community/post'
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
    this.loadPosts().then(() => {
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

