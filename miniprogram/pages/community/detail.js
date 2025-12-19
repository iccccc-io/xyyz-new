// pages/community/detail.js
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    postId: '',
    postData: null,
    authorData: null,
    loading: true,
    isFollowing: false,
    currentImageIndex: 0,
    formatTime: '',
    swiperHeight: 400,
    imageHeights: [],
    likesFormatted: '0',
    commentsFormatted: '0'
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
      postId: options.id
    })

    await this.loadPostDetail()
  },

  /**
   * 加载帖子详情
   */
  async loadPostDetail() {
    this.setData({ loading: true })

    try {
      const postRes = await db.collection('community_posts')
        .doc(this.data.postId)
        .get()

      if (!postRes.data) {
        this.setData({ loading: false })
        wx.showToast({
          title: '帖子不存在',
          icon: 'none'
        })
        return
      }

      const postData = postRes.data

      // 格式化评论时间
      if (postData.comments && postData.comments.length > 0) {
        postData.comments = postData.comments.map(comment => ({
          ...comment,
          create_time: this.formatDate(comment.create_time)
        }))
      }

      // 格式化发布时间
      const formatTime = this.formatDate(postData.create_time)
      
      // 格式化点赞数和评论数
      const likesFormatted = this.formatCount(postData.likes || 0)
      const commentsFormatted = this.formatCount(postData.comments ? postData.comments.length : 0)

      this.setData({
        postData,
        formatTime,
        likesFormatted,
        commentsFormatted,
        imageHeights: new Array(postData.images.length).fill(0)
      })

      console.log('帖子详情:', postData)

      // 查询作者完整信息
      if (postData.author_id) {
        try {
          const authorRes = await db.collection('users')
            .doc(postData.author_id)
            .get()
          
          if (authorRes.data) {
            this.setData({
              authorData: authorRes.data
            })
          }
        } catch (err) {
          console.warn('查询作者信息失败:', err)
        }
      }

      this.setData({ loading: false })

    } catch (err) {
      console.error('加载帖子详情失败:', err)
      this.setData({ loading: false })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  /**
   * 格式化数字（1000显示为1k，10000显示为1w）
   */
  formatCount(num) {
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + 'w'
    } else if (num >= 1000) {
      return (num / 1000).toFixed(0) + 'k'
    }
    return String(num)
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
   * 图片加载完成，计算高度
   */
  onImageLoad(e) {
    const { width, height } = e.detail
    const index = e.currentTarget.dataset.index
    
    // 计算图片实际显示高度（按屏幕宽度等比缩放）
    const systemInfo = wx.getSystemInfoSync()
    const screenWidth = systemInfo.windowWidth
    const realHeight = (screenWidth / width) * height
    
    // 更新对应图片的高度
    const imageHeights = [...this.data.imageHeights]
    imageHeights[index] = realHeight
    
    // 计算最大高度
    const maxHeight = Math.max(...imageHeights.filter(h => h > 0))
    
    this.setData({
      imageHeights,
      swiperHeight: maxHeight > 0 ? maxHeight : 400
    })
  },

  /**
   * 轮播图切换
   */
  onSwiperChange(e) {
    this.setData({
      currentImageIndex: e.detail.current
    })
  },

  /**
   * 预览图片
   */
  previewImage(e) {
    const url = e.currentTarget.dataset.url
    wx.previewImage({
      current: url,
      urls: this.data.postData.images
    })
  },

  /**
   * 跳转到非遗项目详情
   */
  goToProject(e) {
    const projectId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/resource/project-detail?id=${projectId}`
    })
  },

  /**
   * 打开位置地图
   */
  openLocation() {
    const location = this.data.postData.location
    if (!location || !location.latitude || !location.longitude) {
      wx.showToast({
        title: '暂无位置信息',
        icon: 'none'
      })
      return
    }

    wx.openLocation({
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.name,
      scale: 15
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
