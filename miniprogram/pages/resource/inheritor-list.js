const db = wx.cloud.database()

Page({
  data: {
    statusBarHeight: 20,
    headerHeight: 200,
    dataList: [],
    searchKeyword: '',
    loading: false,
    noMore: false,
    pageSize: 20,
    showFilter: false,
    filterData: {
      level: ''
    },
    levelOptions: ['国家级', '省级', '市级', '县级']
  },

  onLoad(options) {
    const sysInfo = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 })

    if (options.city) {
      this.setData({ presetCity: decodeURIComponent(options.city) })
    }
    this._measureHeader()
    this.loadData()
  },

  _measureHeader() {
    setTimeout(() => {
      wx.createSelectorQuery()
        .select('.fixed-header')
        .boundingClientRect(res => {
          if (res) this.setData({ headerHeight: res.height })
        })
        .exec()
    }, 150)
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/home/home' })
    })
  },

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value })
  },

  onSearch() {
    this.setData({ dataList: [], noMore: false })
    this.loadData()
  },

  openFilter() {
    this.setData({ showFilter: true })
  },

  closeFilter() {
    this.setData({ showFilter: false })
  },

  selectFilter(e) {
    const { type, value } = e.currentTarget.dataset
    this.setData({ [`filterData.${type}`]: value })
  },

  resetFilter() {
    this.setData({ filterData: { level: '' } })
  },

  confirmFilter() {
    this.closeFilter()
    this.setData({ dataList: [], noMore: false })
    this.loadData()
  },

  async loadData(loadMore = false) {
    if (this.data.loading || (loadMore && this.data.noMore)) return
    this.setData({ loading: true })

    try {
      const { searchKeyword, filterData, dataList, pageSize, presetCity } = this.data
      const query = {}

      if (searchKeyword) {
        query.name = db.RegExp({ regexp: searchKeyword, options: 'i' })
      }
      if (filterData.level) query.level = filterData.level
      if (presetCity) query.city = presetCity

      const skip = loadMore ? dataList.length : 0
      const res = await db.collection('ich_inheritors')
        .where(query)
        .skip(skip)
        .limit(pageSize)
        .get()

      this.setData({
        dataList: loadMore ? [...dataList, ...res.data] : res.data,
        loading: false,
        noMore: res.data.length < pageSize
      })
    } catch (err) {
      console.error('加载传承人数据失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
    }
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/resource/inheritor-detail?id=${id}` })
  },

  onPullDownRefresh() {
    this.setData({ dataList: [], noMore: false })
    this.loadData().then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    this.loadData(true)
  },

  onShareAppMessage() {
    return { title: '湘韵遗珍 - 非遗传承人', path: '/pages/resource/inheritor-list' }
  }
})
