// pages/resource/list.js
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 当前 Tab: 'project' | 'inheritor'
    currentTab: 'project',
    
    // 列表数据
    dataList: [],
    
    // 搜索关键词
    searchKeyword: '',
    
    // 加载状态
    loading: false,
    
    // 筛选弹窗显示状态
    showFilter: false,
    
    // 筛选条件
    filterData: {
      region: '',
      category: '',
      level: ''
    },
    
    // 顶部高度（用于动态计算）
    headerHeight: 200,
    
    // 硬编码筛选选项 - 湖南地区
    regionOptions: [
      '长沙市',
      '株洲市',
      '湘潭市',
      '衡阳市',
      '邵阳市',
      '岳阳市',
      '常德市',
      '张家界市',
      '益阳市',
      '郴州市',
      '永州市',
      '怀化市',
      '娄底市',
      '湘西土家族苗族自治州'
    ],
    
    // 硬编码筛选选项 - 非遗类别
    categoryOptions: [
      '民间文学',
      '传统音乐',
      '传统舞蹈',
      '传统戏剧',
      '曲艺',
      '传统体育、游艺与杂技',
      '传统美术',
      '传统技艺',
      '传统医药',
      '民俗'
    ],
    
    // 硬编码筛选选项 - 级别
    levelOptions: [
      '联合国教科文组织非遗名录',
      '国家级',
      '省级',
      '市级'
    ]
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 初始化云开发环境
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      wx.showToast({
        title: '云开发初始化失败',
        icon: 'none',
        duration: 3000
      })
      return
    }
    
    // 输出云开发环境信息（调试用）
    console.log('云开发环境已初始化')
    console.log('当前云环境 ID:', wx.cloud.CloudID)
    
    // 计算固定头部高度
    this.calculateHeaderHeight()
    
    // 加载初始数据
    this.loadData()
  },

  /**
   * 计算固定头部高度
   */
  calculateHeaderHeight() {
    const query = wx.createSelectorQuery()
    query.select('.fixed-header').boundingClientRect()
    query.exec((res) => {
      if (res[0]) {
        this.setData({
          headerHeight: res[0].height
        })
      }
    })
  },

  /**
   * 切换 Tab
   */
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.currentTab) return
    
    this.setData({
      currentTab: tab,
      dataList: [],
      searchKeyword: '',
      filterData: {
        region: '',
        category: '',
        level: ''
      }
    })
    
    this.loadData()
  },

  /**
   * 搜索框内容变化
   */
  onSearchChange(e) {
    this.setData({
      searchKeyword: e.detail
    })
  },

  /**
   * 执行搜索
   */
  onSearch() {
    this.loadData()
  },

  /**
   * 打开筛选弹窗
   */
  openFilter() {
    this.setData({
      showFilter: true
    })
  },

  /**
   * 关闭筛选弹窗
   */
  closeFilter() {
    this.setData({
      showFilter: false
    })
  },

  /**
   * 选择筛选项
   */
  selectFilter(e) {
    const { type, value } = e.currentTarget.dataset
    this.setData({
      [`filterData.${type}`]: value
    })
  },

  /**
   * 重置筛选
   */
  resetFilter() {
    this.setData({
      filterData: {
        region: '',
        category: '',
        level: ''
      }
    })
  },

  /**
   * 确定筛选
   */
  confirmFilter() {
    this.closeFilter()
    this.loadData()
  },

  /**
   * 加载数据
   */
  async loadData() {
    this.setData({ loading: true })

    try {
      const collectionName = this.data.currentTab === 'project' ? 'ich_projects' : 'ich_inheritors'
      
      console.log('=== 开始查询数据库 ===')
      console.log('集合名称:', collectionName)
      
      // 构建查询条件
      let query = {}
      
      // 搜索关键词
      if (this.data.searchKeyword) {
        const keyword = this.data.searchKeyword
        if (this.data.currentTab === 'project') {
          // 项目搜索标题
          query.title = db.RegExp({
            regexp: keyword,
            options: 'i'
          })
        } else {
          // 传承人搜索姓名
          query.name = db.RegExp({
            regexp: keyword,
            options: 'i'
          })
        }
      }
      
      // 筛选条件
      if (this.data.filterData.region) {
        query.region = this.data.filterData.region
      }
      
      if (this.data.filterData.category) {
        query.category = this.data.filterData.category
      }
      
      if (this.data.filterData.level) {
        query.level = this.data.filterData.level
      }

      console.log('查询条件:', query)

      // 查询数据库
      const res = await db.collection(collectionName)
        .where(query)
        .limit(100)
        .get()

      console.log('查询结果:', res)
      console.log('数据条数:', res.data.length)

      this.setData({
        dataList: res.data,
        loading: false
      })

      // 如果没有数据，给出更详细的提示
      if (res.data.length === 0) {
        console.warn('⚠️ 数据库返回为空，请检查：')
        console.warn('1. 云开发环境 ID 是否正确配置')
        console.warn('2. 数据库集合名称是否正确:', collectionName)
        console.warn('3. 数据库权限是否设置为"所有用户可读"')
        console.warn('4. 数据是否已正确导入')
        
        wx.showModal({
          title: '数据为空',
          content: `集合 ${collectionName} 中没有数据。\n\n请检查：\n1. 云开发控制台是否已添加数据\n2. 数据库权限是否正确\n3. 集合名称是否匹配`,
          showCancel: false
        })
      }
      
    } catch (err) {
      console.error('❌ 加载数据失败:', err)
      console.error('错误详情:', err.errMsg || err.message)
      this.setData({ loading: false })
      
      wx.showModal({
        title: '加载失败',
        content: `错误信息：${err.errMsg || err.message}\n\n可能原因：\n1. 云开发环境未初始化\n2. 数据库权限设置错误\n3. 网络连接问题`,
        showCancel: false
      })
    }
  },

  /**
   * 跳转到详情页
   */
  goToDetail(e) {
    const { id, type } = e.currentTarget.dataset
    
    if (type === 'project') {
      wx.navigateTo({
        url: `/pages/resource/project-detail?id=${id}`
      })
    } else {
      wx.navigateTo({
        url: `/pages/resource/inheritor-detail?id=${id}`
      })
    }
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
    this.loadData().then(() => {
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

