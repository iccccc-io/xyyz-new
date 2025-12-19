// pages/venue/detail.js
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    venueId: '',
    venueData: null,
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
      venueId: options.id
    })

    await this.loadVenueDetail()
  },

  /**
   * 加载场所详情
   */
  async loadVenueDetail() {
    this.setData({ loading: true })

    try {
      // 1. 查询场所基本信息
      const venueRes = await db.collection('ich_venues')
        .doc(this.data.venueId)
        .get()

      if (!venueRes.data) {
        this.setData({ loading: false })
        wx.showToast({
          title: '场所不存在',
          icon: 'none'
        })
        return
      }

      const venueData = venueRes.data
      this.setData({ venueData })

      console.log('场所详情:', venueData)

      // 2. 如果有相关资讯，查询资讯列表
      if (venueData.related_news_ids && venueData.related_news_ids.length > 0) {
        try {
          const newsRes = await db.collection('ich_news')
            .where({
              _id: db.command.in(venueData.related_news_ids)
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
      console.error('加载场所详情失败:', err)
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
   * 打开地图导航
   */
  openMap() {
    const venue = this.data.venueData
    
    if (!venue.geo_point || !venue.geo_point.coordinates) {
      wx.showToast({
        title: '暂无位置信息',
        icon: 'none'
      })
      return
    }

    const [longitude, latitude] = venue.geo_point.coordinates

    wx.openLocation({
      latitude: latitude,
      longitude: longitude,
      name: venue.name,
      address: venue.address,
      scale: 15,
      success: () => {
        console.log('打开地图成功')
      },
      fail: (err) => {
        console.error('打开地图失败:', err)
        wx.showToast({
          title: '打开地图失败',
          icon: 'none'
        })
      }
    })
  },

  /**
   * 拨打电话
   */
  makePhoneCall() {
    const phone = this.data.venueData.phone
    
    if (!phone) {
      wx.showToast({
        title: '暂无联系电话',
        icon: 'none'
      })
      return
    }

    wx.makePhoneCall({
      phoneNumber: phone,
      success: () => {
        console.log('拨打电话成功')
      },
      fail: (err) => {
        console.error('拨打电话失败:', err)
        wx.showToast({
          title: '拨打失败',
          icon: 'none'
        })
      }
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

