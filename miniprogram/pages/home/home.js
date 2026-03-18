// pages/home/home.js
const echarts = require('../../components/ec-canvas/echarts');
const hunanGeoJson = require('./hunan');

// 抽屉露出高度使用 rpx→px 换算，确保不同机型视觉一致
// 设计稿上约 180rpx（把手 + Tab 栏），运行时动态转 px
const SHEET_PEEK_RPX = 180;
const DEFAULT_QUOTE = '三湘四水，钟灵毓秀。在这里，探寻湖南非遗之美。';
const LEVEL_ORDER = ['国家级', '省级', '市级', '县级'];

const BUILTIN_QUOTES = {
  '长沙市': ['星城长沙，湘绣花开，铜官窑火千年不灭。', '岳麓山下，楚汉名城，花鼓戏韵传唱至今。'],
  '株洲市': ['炎帝故里，神农遗风，攸县打铁水照亮夜空。', '醴陵瓷都，釉下五彩，千年窑火匠心不改。'],
  '湘潭市': ['伟人故里，莲城韵味，湘潭石雕刻画湖湘风骨。', '红色热土，文脉绵延，皮影戏中见湖湘春秋。'],
  '衡阳市': ['雁城衡阳，南岳独秀，衡州花鼓唱不尽乡愁。', '石鼓书声，千年回响，南岳庙会香火传承。'],
  '邵阳市': ['宝庆邵阳，竹刻双绝，滩头年画印出新春。', '崀山丹霞，蓝印花布，邵阳布袋戏妙趣横生。'],
  '岳阳市': ['巴陵岳阳，洞庭波涌，汨罗龙舟竞渡端阳。', '岳阳楼记，千古名篇，巴陵戏腔穿越古今。'],
  '常德市': ['桃花源里，常德丝弦悠悠入梦来。', '武陵故地，澧水欢歌，常德高腔声震云霄。'],
  '张家界市': ['奇峰三千，秀水八百，桑植民歌回荡在大山深处。', '土家吊脚楼，大庸阳戏，张家界的山水藏着千年故事。'],
  '益阳市': ['银城益阳，竹海连绵，安化黑茶香飘万里。', '洞庭之滨，益阳弹词说尽人间烟火。'],
  '郴州市': ['林中之城，瑶族长鼓舞翩翩起，昆曲悠扬入郴山。', '北有苏杭，南有郴州，嘉禾伴嫁歌唱出客家深情。'],
  '永州市': ['潇湘永州，柳宗元笔下的诗意之地，祁剧声腔绕梁不绝。', '零陵古郡，女书传奇，千年文字只在女子间流传。'],
  '怀化市': ['五溪之地，侗歌飘过风雨桥，辰河高腔震山谷。', '芷江受降，历史铭记，怀化傩戏面具后藏着远古的神秘。'],
  '娄底市': ['梅山文化发源地，新化山歌嘹亮，紫鹊界梯田如诗如画。', '锑都锡矿山，工业遗产与梅山武术交相辉映。'],
  '湘西土家族苗族自治州': ['神秘湘西，赶尸传说与苗族银饰交织成奇幻画卷。', '凤凰古城，土家织锦五彩斑斓，苗族鼓舞震天动地。'],
};

Page({
  data: {
    statusBarHeight: 20,
    windowHeight: 750,
    windowWidth: 375,
    mapLoading: true,
    ec: { lazyLoad: true },
    showCanvas: true,

    selectedCity: '',

    statsLoading: true,
    totalStats: { projectCount: 0, inheritorCount: 0 },
    statsData: { projectCount: 0, inheritorCount: 0 },
    projectDigits: [0],
    inheritorDigits: [0],
    digitSlots: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    cityStats: {},

    cityQuote: DEFAULT_QUOTE,
    quoteVisible: true,

    sheetHeight: 600,
    sheetTranslateY: 512,
    sheetTransition: 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)',
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
  _sheetCollapsedOffset: 0,
  _cityQuotesMap: {},
  _cityDetailStats: {},

  // ═══════════ 生命周期 ═══════════

  onLoad() {
    const sys = wx.getSystemInfoSync();
    const statusBarHeight = sys.statusBarHeight || 20;
    const windowHeight = sys.windowHeight || 750;
    const windowWidth = sys.windowWidth || 375;
    const rpx2px = windowWidth / 750;
    const tabBarHeight = Math.round(100 * rpx2px);
    const sheetPeekHeight = Math.round(SHEET_PEEK_RPX * rpx2px);
    const sheetHeight = Math.round(windowHeight * 0.83) - tabBarHeight;
    const sheetCollapsedOffset = sheetHeight - sheetPeekHeight;

    this._sheetCollapsedOffset = sheetCollapsedOffset;
    this._sheetPeekHeight = sheetPeekHeight;
    this.setData({
      statusBarHeight, windowHeight, windowWidth, sheetHeight,
      sheetTranslateY: sheetCollapsedOffset,
      newsScrollHeight: sheetHeight - sheetPeekHeight,
      tabBarHeight,
      baseBottomSpace: tabBarHeight + sheetPeekHeight,
    });
  },

  onReady() {
    this._initMap();
    this._loadData();
    this._calibrateSheetPeek();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateActive(0);
    }
    if (!this.data.showCanvas && !this.data.isExpanded) {
      setTimeout(() => this._showAndReinitCanvas(), 400);
    }
  },

  // 动态测量 sheet-header 实际高度，确保 Tab 下边线卡在屏幕边缘
  _calibrateSheetPeek() {
    setTimeout(() => {
      wx.createSelectorQuery()
        .select('.sheet-header')
        .boundingClientRect(rect => {
          if (!rect || rect.height <= 0) return;
          const peekH = Math.ceil(rect.height);
          if (Math.abs(peekH - this._sheetPeekHeight) < 2) return;
          const offset = this.data.sheetHeight - peekH;
          this._sheetCollapsedOffset = offset;
          this._sheetPeekHeight = peekH;
          this.setData({
            sheetTranslateY: offset,
            newsScrollHeight: this.data.sheetHeight - peekH,
            baseBottomSpace: this.data.tabBarHeight + peekH,
          });
        })
        .exec();
    }, 500);
  },

  // ═══════════ 全屏上划手势 ═══════════

  _swipeStartY: 0,
  _swipeStartX: 0,

  onPageSwipeStart(e) {
    this._swipeStartY = e.touches[0].pageY;
    this._swipeStartX = e.touches[0].pageX;
  },

  onPageSwipeEnd(e) {
    if (this.data.isExpanded) return;
    const endY = e.changedTouches[0].pageY;
    const endX = e.changedTouches[0].pageX;
    const deltaY = this._swipeStartY - endY;
    const deltaX = Math.abs(endX - this._swipeStartX);
    // 主要向上（deltaY 远大于水平偏移）且滑动距离 >50px
    if (deltaY > 50 && deltaY > deltaX * 1.5) {
      this._expandSheet();
    }
  },

  // ═══════════ Canvas ═══════════

  _hideCanvas() {
    if (!this.data.showCanvas) return;
    this._chart = null;
    this.setData({ showCanvas: false });
  },

  _showAndReinitCanvas() {
    if (this.data.showCanvas) return;
    this.setData({ showCanvas: true });
    setTimeout(() => this._initMap(), 150);
  },

  // ═══════════ ECharts ═══════════

  _initMap() {
    if (!echarts) { this.setData({ mapLoading: false }); return; }
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
    echarts.registerMap('hunan', hunanGeoJson);

    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: { show: false },
      series: [{
        type: 'map',
        map: 'hunan',
        roam: false,
        selectedMode: 'single',
        layoutCenter: ['50%', '52%'],
        layoutSize: '98%',
        label: { show: true, color: '#6b4226', fontSize: 8 },
        itemStyle: { areaColor: '#e8d5a8', borderColor: '#ffffff', borderWidth: 1.5 },
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
    });

    this.setData({ mapLoading: false });

    if (Object.keys(this.data.cityStats).length) {
      this._updateMapSeriesData(this.data.cityStats);
    }
    if (this.data.selectedCity) {
      chart.dispatchAction({ type: 'mapSelect', name: this.data.selectedCity });
    }

    chart.on('click', (params) => {
      if (params.componentType === 'series' && params.name) {
        this._handleCityClick(params.name);
      }
    });
  },

  // ═══════════ 城市交互 ═══════════

  _handleCityClick(cityName) {
    const currentCity = this.data.selectedCity;

    if (currentCity === cityName) {
      this._deselectCity();
      return;
    }

    if (currentCity && this._chart) {
      this._chart.dispatchAction({ type: 'mapUnSelect', name: currentCity });
    }

    this.setData({ selectedCity: cityName });
    this._updateStatsDisplay(cityName);
    this._updateQuote(cityName);
  },

  _deselectCity() {
    if (this._chart && this.data.selectedCity) {
      this._chart.dispatchAction({ type: 'mapUnSelect', name: this.data.selectedCity });
    }
    this.setData({ selectedCity: '' });
    this._updateStatsDisplay('');
    this._updateQuote('');
  },

  _updateStatsDisplay(cityName) {
    const target = !cityName
      ? this.data.totalStats
      : (this.data.cityStats[cityName] || { projectCount: 0, inheritorCount: 0 });
    this.setData({
      statsData: target,
      projectDigits: this._numToDigits(target.projectCount),
      inheritorDigits: this._numToDigits(target.inheritorCount),
    });
  },

  _numToDigits(num) {
    if (!num || num <= 0) return [0];
    return String(num).split('').map(Number);
  },

  _updateMapSeriesData(cityStats) {
    if (!this._chart) return;
    const data = Object.entries(cityStats).map(([name, s]) => ({
      name, value: s.projectCount,
    }));
    this._chart.setOption({ series: [{ data }] });
  },

  // ═══════════ 文化名片 ═══════════

  _updateQuote(cityName) {
    this.setData({ quoteVisible: false });
    setTimeout(() => {
      let quote = DEFAULT_QUOTE;
      if (cityName) {
        // 优先用云端数据，没有则用内置文案
        const cloudQuotes = this._cityQuotesMap[cityName];
        const builtinQuotes = BUILTIN_QUOTES[cityName];
        const pool = (cloudQuotes && cloudQuotes.length) ? cloudQuotes
                   : (builtinQuotes && builtinQuotes.length) ? builtinQuotes : null;
        if (pool) {
          quote = pool[Math.floor(Math.random() * pool.length)];
        }
      }
      this.setData({ cityQuote: quote, quoteVisible: true });
    }, 300);
  },

  _loadCityQuotes() {
    wx.cloud.database().collection('ich_cityquotes').limit(20).get()
      .then(({ data }) => {
        const map = {};
        data.forEach(item => { map[item.city] = item.quotes || []; });
        this._cityQuotesMap = map;
      })
      .catch(() => {});
  },

  // ═══════════ 数据加载 ═══════════

  _loadData() {
    this._loadStats();
    this._loadNews();
    this._loadCityQuotes();
  },

  _loadStats() {
    const db = wx.cloud.database();

    // Phase 1：count() — 最可靠，直接拿总数
    Promise.all([
      db.collection('ich_projects').count(),
      db.collection('ich_inheritors').count(),
    ]).then(([projRes, inheRes]) => {
      console.log('[home] count() → 项目:', projRes.total, '传承人:', inheRes.total);
      const t = {
        projectCount: projRes.total || 0,
        inheritorCount: inheRes.total || 0,
      };
      this.setData({
        statsLoading: false, totalStats: t, statsData: t,
        projectDigits: this._numToDigits(t.projectCount),
        inheritorDigits: this._numToDigits(t.inheritorCount),
      });
    }).catch(err => {
      console.error('[home] count() 失败:', err);
      this.setData({ statsLoading: false });
    });

    // Phase 2：分页 get() 拉全量，统计按城市+级别
    this._loadCityDetailStats();
  },

  async _loadCityDetailStats() {
    const db = wx.cloud.database();

    try {
      const [projCountRes, inheCountRes] = await Promise.all([
        db.collection('ich_projects').count(),
        db.collection('ich_inheritors').count(),
      ]);

      // 微信云数据库客户端 get() 单次上限 20 条，必须按 20 分页
      const MAX_LIMIT = 20;
      const fetchAll = async (collName, total) => {
        if (!total) return [];
        const batches = Math.ceil(total / MAX_LIMIT);
        const tasks = [];
        for (let i = 0; i < batches; i++) {
          tasks.push(db.collection(collName).skip(i * MAX_LIMIT).limit(MAX_LIMIT).get());
        }
        return (await Promise.all(tasks)).reduce((acc, r) => acc.concat(r.data), []);
      };

      const [projects, inheritors] = await Promise.all([
        fetchAll('ich_projects', projCountRes.total || 0),
        fetchAll('ich_inheritors', inheCountRes.total || 0),
      ]);

      if (projects.length > 0) {
        console.log('[home] 项目样例:', JSON.stringify(projects[0]).substring(0, 200));
      }
      if (inheritors.length > 0) {
        console.log('[home] 传承人样例:', JSON.stringify(inheritors[0]).substring(0, 200));
      }

      const cityStats = {};
      const cityDetail = {};

      const ensureCity = (city) => {
        if (!cityStats[city]) cityStats[city] = { projectCount: 0, inheritorCount: 0 };
        if (!cityDetail[city]) cityDetail[city] = { projectByLevel: {}, inheritorByLevel: {} };
      };

      projects.forEach(item => {
        const city = item.city;
        if (!city) return;
        ensureCity(city);
        cityStats[city].projectCount++;
        if (item.level) {
          cityDetail[city].projectByLevel[item.level] =
            (cityDetail[city].projectByLevel[item.level] || 0) + 1;
        }
      });

      inheritors.forEach(item => {
        const city = item.city;
        if (!city) return;
        ensureCity(city);
        cityStats[city].inheritorCount++;
        if (item.level) {
          cityDetail[city].inheritorByLevel[item.level] =
            (cityDetail[city].inheritorByLevel[item.level] || 0) + 1;
        }
      });

      console.log('[home] 城市统计完成:', Object.keys(cityStats).join(', '));

      this._cityDetailStats = cityDetail;

      // 只更新 cityStats，不覆盖省级总数（totalStats 来自 count()，最准确）
      this.setData({ cityStats });
      this._updateMapSeriesData(cityStats);

      if (this.data.selectedCity) {
        this._updateStatsDisplay(this.data.selectedCity);
      }

    } catch (err) {
      console.error('[home] _loadCityDetailStats 失败:', err);
    }
  },

  _loadNews() {
    this.setData({ newsLoading: true });
    wx.cloud.database()
      .collection('ich_news')
      .orderBy('update_time', 'desc')
      .limit(30)
      .get()
      .then(({ data }) => {
        const format = (item) => ({
          ...item,
          publish_date_str: this._formatDate(item.update_time),
        });
        const flash = data.filter(n => !n.category || n.category === '非遗快讯').map(format);
        const policy = data.filter(n => n.category === '政策法规').map(format);
        this.setData({
          newsLoading: false, flashNewsList: flash, policyNewsList: policy, newsList: flash,
        });
      })
      .catch(() => { this.setData({ newsLoading: false }); });
  },

  _formatDate(date) {
    if (!date) return '';
    try {
      const d = date instanceof Date ? date : new Date(date);
      if (isNaN(d.getTime())) return String(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } catch (e) { return ''; }
  },

  // ═══════════ Tab ═══════════

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this.setData({
      activeTab: tab,
      newsList: tab === 'flash' ? this.data.flashNewsList : this.data.policyNewsList,
    });
    if (!this.data.isExpanded) this._expandSheet();
  },

  // ═══════════ Bottom Sheet ═══════════

  _expandSheet() {
    this._hideCanvas();
    this.setData({
      sheetTranslateY: 0,
      sheetTransition: 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)',
      isExpanded: true, showBackdrop: true, backdropOpacity: 1,
    });
  },

  collapseSheet() {
    this.setData({
      sheetTranslateY: this._sheetCollapsedOffset,
      sheetTransition: 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)',
      isExpanded: false, showBackdrop: false, backdropOpacity: 0,
    });
    setTimeout(() => this._showAndReinitCanvas(), 380);
  },

  // ═══════════ 导航 ═══════════

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
    if (!id) return;
    this._hideCanvas();
    wx.navigateTo({ url: `/pages/resource/news-detail?id=${id}` });
  },

  onShareAppMessage() {
    return { title: '湘韵遗珍 - 探索湖南非物质文化遗产', path: '/pages/home/home' };
  },
});
