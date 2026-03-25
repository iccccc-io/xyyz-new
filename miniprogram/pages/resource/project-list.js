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
      city: '',
      category: '',
      level: '',
      batch: ''
    },
    cityOptions: [
      '长沙市', '株洲市', '湘潭市', '衡阳市', '邵阳市', '岳阳市',
      '常德市', '张家界市', '益阳市', '郴州市', '永州市', '怀化市',
      '娄底市', '湘西土家族苗族自治州'
    ],
    categoryOptions: [
      '民间文学', '传统音乐', '传统舞蹈', '传统戏剧', '曲艺',
      '传统体育', '传统美术', '传统技艺', '传统医药', '民俗'
    ],
    levelOptions: ['国家级', '省级', '市级', '县级'],
    batchOptions: [
      '第一批', '第二批', '第三批', '第四批', '第五批',
      '第六批', '第七批', '第八批', '第九批', '第十批'
    ]
  },

  onLoad(options) {
    const sysInfo = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 })

    if (options.city) {
      this.setData({
        filterData: { ...this.data.filterData, city: decodeURIComponent(options.city) }
      })
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
    this.setData({
      filterData: { city: '', category: '', level: '', batch: '' }
    })
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
      const { searchKeyword, filterData, dataList, pageSize } = this.data
      const query = {}

      if (searchKeyword) {
        query.name = db.RegExp({ regexp: searchKeyword, options: 'i' })
      }
      if (filterData.city) query.city = filterData.city
      if (filterData.category) query.category = filterData.category
      if (filterData.level) query.level = filterData.level
      if (filterData.batch) query.batch = filterData.batch

      const skip = loadMore ? dataList.length : 0
      const res = await db.collection('ich_projects')
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
      console.error('加载项目数据失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
    }
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/resource/project-detail?id=${id}` })
  },

  onPullDownRefresh() {
    this.setData({ dataList: [], noMore: false })
    this.loadData().then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    this.loadData(true)
  },

  onShareAppMessage() {
    return { title: '湘韵遗珍 - 非遗项目', path: '/pages/resource/project-list' }
  }
})
