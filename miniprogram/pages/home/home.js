// pages/home/home.js
const echarts = require('../../components/ec-canvas/echarts');
const hunanGeoJson = require('./hunan');

const SHEET_PEEK_HEIGHT = 88;

Page({
  data: {
    statusBarHeight: 20,
    windowHeight: 750,

    mapHeight: 300,
    mapLoading: true,
    ec: { lazyLoad: true },

    // wx:if 控制 ec-canvas 的存亡——唯一能对抗原生 canvas 穿透的手段
    showCanvas: true,

    selectedCity: '',

    statsLoading: true,
    statsData: { projectCount: '...', inheritorCount: '...' },
    cityStats: {},

    sheetHeight: 600,
    sheetTranslateY: 512,
    sheetTransition: 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    isExpanded: false,
    showBackdrop: false,
    backdropOpacity: 0,
    newsScrollHeight: 500,
    tabBarHeight: 50,
    baseBottomSpace: 138,

    activeTab: 'flash',

    newsLoading: false,
    newsList: [],
    flashNewsList: [],
    policyNewsList: [],
  },

  _chart: null,
  _touchStartY: 0,
  _touchStartTranslateY: 0,
  _sheetCollapsedOffset: 0,
  _mapInited: false,

  // ══════════════════════════════════════════════════
  // 生命周期
  // ══════════════════════════════════════════════════

  onLoad() {
    const sys = wx.getSystemInfoSync();
    const statusBarHeight = sys.statusBarHeight || 20;
    const windowHeight = sys.windowHeight || 750;
    const windowWidth = sys.windowWidth || 375;

    const tabBarHeight = Math.round(100 / 750 * windowWidth);
    const mapHeight = Math.round(windowHeight * 0.42);
    const sheetHeight = Math.round(windowHeight * 0.83) - tabBarHeight;
    const sheetCollapsedOffset = sheetHeight - SHEET_PEEK_HEIGHT;
    const newsScrollHeight = sheetHeight - SHEET_PEEK_HEIGHT;

    this._sheetCollapsedOffset = sheetCollapsedOffset;

    this.setData({
      statusBarHeight,
      windowHeight,
      mapHeight,
      sheetHeight,
      sheetTranslateY: sheetCollapsedOffset,
      newsScrollHeight,
      tabBarHeight,
      baseBottomSpace: tabBarHeight + SHEET_PEEK_HEIGHT,
    });
  },

  onReady() {
    this._initMap();
    this._loadData();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateActive(0);
    }
    // 如果 canvas 被销毁了（页面跳转前设为 false），在页面返回时恢复
    if (!this.data.showCanvas) {
      // 延迟到页面转场动画结束后再恢复，避免 canvas 闪烁
      setTimeout(() => {
        this._showAndReinitCanvas();
      }, 400);
    }
  },

  // ══════════════════════════════════════════════════
  // Canvas 生命周期管理
  // ══════════════════════════════════════════════════

  _hideCanvas() {
    if (!this.data.showCanvas) return;
    this._chart = null;
    this.setData({ showCanvas: false });
  },

  _showAndReinitCanvas() {
    if (this.data.showCanvas) return;
    this.setData({ showCanvas: true });
    // wx:if 重新创建组件后，需等待 DOM 渲染完成再调用 init
    setTimeout(() => {
      this._initMap();
    }, 150);
  },

  // ══════════════════════════════════════════════════
  // ECharts 地图
  // ══════════════════════════════════════════════════

  _initMap() {
    if (!echarts) {
      this.setData({ mapLoading: false });
      return;
    }
    const comp = this.selectComponent('#hunan-map');
    if (!comp) return;

    comp.init((canvas, width, height, dpr) => {
      const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
      this._chart = chart;
      this._renderMap(chart);
      return chart;
    });
  },

  _renderMap(chart) {
    // registerMap 是幂等的，重复调用不会出问题
    echarts.registerMap('hunan', hunanGeoJson);

    const option = {
      backgroundColor: 'transparent',
      tooltip: { show: false },
      series: [{
        type: 'map',
        map: 'hunan',
        roam: false,
        selectedMode: 'single',
        layoutCenter: ['50%', '52%'],
        layoutSize: '98%',
        label: {
          show: true,
          color: '#6b4226',
          fontSize: 8,
        },
        itemStyle: {
          areaColor: '#e8d5a8',
          borderColor: '#ffffff',
          borderWidth: 1.5,
        },
        emphasis: {
          label: { color: '#ffffff', fontWeight: 'bold', fontSize: 9 },
          itemStyle: { areaColor: '#d4534a' },
        },
        select: {
          label: { color: '#ffffff', fontWeight: 'bold', fontSize: 9 },
          itemStyle: { areaColor: '#b63b36' },
        },
        data: [],
      }],
    };

    chart.setOption(option);
    this.setData({ mapLoading: false });
    this._mapInited = true;

    // 如果有统计数据，注入 series.data
    if (this.data.cityStats && Object.keys(this.data.cityStats).length) {
      this._updateMapSeriesData(this.data.cityStats);
    }

    // 恢复之前选中的城市
    if (this.data.selectedCity) {
      chart.dispatchAction({
        type: 'mapSelect',
        name: this.data.selectedCity,
      });
    }

    chart.on('click', (params) => {
      if (params.componentType === 'series' && params.name) {
        this._handleCityClick(params.name);
      }
    });
  },

  _handleCityClick(cityName) {
    const currentCity = this.data.selectedCity;
    const newCity = currentCity === cityName ? '' : cityName;

    if (!newCity && this._chart) {
      this._chart.dispatchAction({ type: 'mapUnSelect', name: currentCity });
    }

    this.setData({ selectedCity: newCity });
    this._updateStatsDisplay(newCity);
  },

  clearCitySelect() {
    if (this._chart && this.data.selectedCity) {
      this._chart.dispatchAction({ type: 'mapUnSelect', name: this.data.selectedCity });
    }
    this.setData({ selectedCity: '' });
    this._updateStatsDisplay('');
  },

  _updateStatsDisplay(cityName) {
    const { cityStats } = this.data;
    if (!cityName) {
      const total = Object.values(cityStats).reduce(
        (acc, c) => ({
          projectCount: acc.projectCount + c.projectCount,
          inheritorCount: acc.inheritorCount + c.inheritorCount,
        }),
        { projectCount: 0, inheritorCount: 0 }
      );
      this.setData({ statsData: total });
    } else {
      this.setData({
        statsData: cityStats[cityName] || { projectCount: 0, inheritorCount: 0 },
      });
    }
  },

  _updateMapSeriesData(cityStats) {
    if (!this._chart) return;
    const data = Object.entries(cityStats).map(([name, s]) => ({
      name,
      value: s.projectCount,
    }));
    this._chart.setOption({ series: [{ data }] });
  },

  // ══════════════════════════════════════════════════
  // 数据加载
  // ══════════════════════════════════════════════════

  _loadData() {
    this._loadStats();
    this._loadNews();
  },

  _loadStats() {
    const db = wx.cloud.database();
    Promise.all([
      db.collection('ich_projects').field({ region: true }).limit(500).get(),
      db.collection('ich_inheritors').field({ region: true }).limit(500).get(),
    ]).then(([projRes, inheRes]) => {
      const cityStats = {};

      projRes.data.forEach(({ region }) => {
        if (!region) return;
        if (!cityStats[region]) cityStats[region] = { projectCount: 0, inheritorCount: 0 };
        cityStats[region].projectCount++;
      });

      inheRes.data.forEach(({ region }) => {
        if (!region) return;
        if (!cityStats[region]) cityStats[region] = { projectCount: 0, inheritorCount: 0 };
        cityStats[region].inheritorCount++;
      });

      const total = Object.values(cityStats).reduce(
        (acc, c) => ({
          projectCount: acc.projectCount + c.projectCount,
          inheritorCount: acc.inheritorCount + c.inheritorCount,
        }),
        { projectCount: 0, inheritorCount: 0 }
      );

      this.setData({ statsLoading: false, statsData: total, cityStats });
      this._updateMapSeriesData(cityStats);
    }).catch(() => {
      this.setData({
        statsLoading: false,
        statsData: { projectCount: '--', inheritorCount: '--' },
      });
    });
  },

  _loadNews() {
    this.setData({ newsLoading: true });
    wx.cloud.database()
      .collection('ich_news')
      .orderBy('publish_date', 'desc')
      .limit(30)
      .get()
      .then(({ data }) => {
        const format = (item) => ({
          ...item,
          publish_date_str: this._formatDate(item.publish_date),
        });
        const flash = data.filter(n => !n.category || n.category === '非遗快讯').map(format);
        const policy = data.filter(n => n.category === '政策法规').map(format);
        this.setData({
          newsLoading: false,
          flashNewsList: flash,
          policyNewsList: policy,
          newsList: flash,
        });
      })
      .catch(() => {
        this.setData({ newsLoading: false });
      });
  },

  _formatDate(date) {
    if (!date) return '';
    try {
      const d = date instanceof Date ? date : new Date(date);
      if (isNaN(d.getTime())) return String(date);
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${m}-${day}`;
    } catch (e) {
      return '';
    }
  },

  // ══════════════════════════════════════════════════
  // Tab 切换
  // ══════════════════════════════════════════════════

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    const newsList = tab === 'flash' ? this.data.flashNewsList : this.data.policyNewsList;
    this.setData({ activeTab: tab, newsList });
    if (!this.data.isExpanded) {
      this._expandSheet();
    }
  },

  // ══════════════════════════════════════════════════
  // Bottom Sheet 拖拽
  // ══════════════════════════════════════════════════

  _expandSheet() {
    // 展开面板前，先销毁 canvas，防止穿透
    this._hideCanvas();
    this.setData({
      sheetTranslateY: 0,
      sheetTransition: 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      isExpanded: true,
      showBackdrop: true,
      backdropOpacity: 1,
    });
  },

  collapseSheet() {
    this.setData({
      sheetTranslateY: this._sheetCollapsedOffset,
      sheetTransition: 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      isExpanded: false,
      showBackdrop: false,
      backdropOpacity: 0,
    });
    // 面板收起动画结束后，重新创建 canvas
    setTimeout(() => {
      this._showAndReinitCanvas();
    }, 380);
  },

  onSheetTouchStart(e) {
    this._touchStartY = e.touches[0].pageY;
    this._touchStartTranslateY = this.data.sheetTranslateY;
    this.setData({ sheetTransition: 'none' });
    // 手指按下的瞬间就销毁 canvas，让拖拽全程无穿透
    this._hideCanvas();
  },

  onSheetTouchMove(e) {
    const delta = e.touches[0].pageY - this._touchStartY;
    let newY = this._touchStartTranslateY + delta;
    newY = Math.max(0, Math.min(newY, this._sheetCollapsedOffset));

    const progress = 1 - newY / this._sheetCollapsedOffset;
    this.setData({
      sheetTranslateY: newY,
      backdropOpacity: progress,
      showBackdrop: progress > 0.01,
    });
  },

  onSheetTouchEnd() {
    const currentY = this.data.sheetTranslateY;
    const threshold = this._sheetCollapsedOffset * 0.45;
    if (currentY < threshold) {
      this._expandSheet();
    } else {
      this.collapseSheet();
    }
  },

  onNewsScroll() {},

  // ══════════════════════════════════════════════════
  // 页面导航
  // ══════════════════════════════════════════════════

  goToProjects() {
    const city = this.data.selectedCity;
    this._hideCanvas();
    wx.navigateTo({
      url: `/pages/resource/list?tab=project${city ? '&city=' + encodeURIComponent(city) : ''}`,
    });
  },

  goToInheritors() {
    const city = this.data.selectedCity;
    this._hideCanvas();
    wx.navigateTo({
      url: `/pages/resource/list?tab=inheritor${city ? '&city=' + encodeURIComponent(city) : ''}`,
    });
  },

  goToNewsDetail(e) {
    const id = e.currentTarget.dataset.id;
    this._hideCanvas();
    wx.navigateTo({ url: `/pages/resource/news-detail?news_id=${id}` });
  },

  navigateToUser() {
    this._hideCanvas();
    wx.switchTab({ url: '/pages/gerenzhongxin/gerenzhongxin' });
  },

  onShareAppMessage() {
    return {
      title: '湘韵遗珍 - 探索湖南非物质文化遗产',
      path: '/pages/home/home',
    };
  },
});
