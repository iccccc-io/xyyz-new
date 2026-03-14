/**
 * 云函数：getLogisticsTrack
 * 调用快递100实时查询接口，获取物流轨迹
 *
 * 安全策略：
 *  - key / customer / secret 仅存于云函数，前端不可见
 *  - 签名在服务端生成
 *
 * 缓存策略：
 *  - 查询结果缓存到 shopping_orders.logistics_cache
 *  - 30 分钟内重复查询直接返回缓存
 *
 * @param {string} event.order_id - 订单 ID
 * @returns {{ success, data, state, stateDesc, carrier, trackingNumber, isCache }}
 */
const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// ===== 快递100 授权信息（仅在云端，前端不可见） =====
const KD100_KEY      = 'xSFZeJHR7721'
const KD100_CUSTOMER = '72ECB543C51395B780C9DEC8DBB03166'

// 缓存有效期（毫秒）
const CACHE_TTL = 30 * 60 * 1000

// 我们系统的快递代码 → 快递100 编码映射
const CARRIER_MAP = {
  SF:    'shunfeng',
  YTO:   'yuantong',
  ZTO:   'zhongtong',
  STO:   'shentong',
  YUNDA: 'yunda',
  JD:    'jd',
  EMS:   'ems',
  OTHER: ''
}

// 快递100 state 状态码描述
const STATE_DESC = {
  '0': '在途中',
  '1': '已揽收',
  '2': '疑难件',
  '3': '已签收',
  '4': '退签',
  '5': '派送中',
  '6': '退回',
  '7': '转投',
  '10': '待清关',
  '11': '清关中',
  '12': '已清关',
  '13': '清关异常',
  '14': '收件人拒签'
}

/**
 * 生成快递100签名
 * sign = MD5(param + key + customer) 转32位大写
 */
function makeSign(paramStr) {
  const raw = paramStr + KD100_KEY + KD100_CUSTOMER
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex').toUpperCase()
}

/**
 * 调用快递100实时查询接口
 */
async function queryKD100(com, num, phone) {
  const param = JSON.stringify({
    com,
    num,
    phone: phone || '',
    resultv2: '4'
  })

  const sign = makeSign(param)

  const https = require('https')
  const querystring = require('querystring')

  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      customer: KD100_CUSTOMER,
      sign,
      param
    })

    const options = {
      hostname: 'poll.kuaidi100.com',
      port: 443,
      path: '/poll/query.do',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }

    const req = https.request(options, (resp) => {
      let data = ''
      resp.on('data', chunk => { data += chunk })
      resp.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error('快递100返回数据解析失败: ' + data.substring(0, 200)))
        }
      })
    })

    req.on('error', reject)
    req.write(postData)
    req.end()
  })
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { order_id } = event

  if (!order_id) {
    return { success: false, message: '参数错误：缺少订单ID' }
  }

  try {
    // ========== 1. 查询订单 ==========
    let orderRes
    try {
      orderRes = await db.collection('shopping_orders').doc(order_id).get()
    } catch (e) {
      return { success: false, message: '订单不存在' }
    }

    const order = orderRes.data

    // ========== 2. 权限校验：买家或卖家才能查 ==========
    const isBuyer = (order._openid === openid)
    const isSeller = (order.seller_openid === openid)

    if (!isBuyer && !isSeller) {
      // 进一步检查：卖家可能通过 workshop 关联
      let isWorkshopOwner = false
      if (order.workshop_id) {
        try {
          const wsRes = await db.collection('shopping_workshops').doc(order.workshop_id).get()
          if (wsRes.data && wsRes.data.owner_id === openid) {
            isWorkshopOwner = true
          }
        } catch (_) {}
      }
      if (!isWorkshopOwner) {
        return { success: false, message: '无权查看此订单物流' }
      }
    }

    // ========== 3. 检查物流信息 ==========
    if (!order.tracking_number) {
      return { success: false, message: '暂无物流信息' }
    }

    const carrierCode = order.carrier_code || ''
    const trackingNumber = order.tracking_number

    // ========== 4. 缓存检查 ==========
    if (order.logistics_cache && order.logistics_last_query) {
      const lastQuery = new Date(order.logistics_last_query).getTime()
      const now = Date.now()
      if (now - lastQuery < CACHE_TTL) {
        console.log(`[物流] 命中缓存: 订单=${order_id}, 距上次查询=${Math.round((now - lastQuery) / 1000)}s`)
        return {
          success: true,
          isCache: true,
          cacheAge: Math.round((now - lastQuery) / 1000),
          carrier: carrierCode,
          carrierName: getCarrierName(carrierCode),
          trackingNumber,
          state: order.logistics_cache.state,
          stateDesc: STATE_DESC[order.logistics_cache.state] || '未知',
          data: order.logistics_cache.data || []
        }
      }
    }

    // ========== 5. 请求快递100 ==========
    const kd100Com = CARRIER_MAP[carrierCode] || carrierCode.toLowerCase()

    if (!kd100Com) {
      return { success: false, message: '无法识别快递公司编码，请联系卖家核实' }
    }

    // 顺丰/中通需要手机号（兼容 telNumber 和 phone 两种字段名）
    const addr = order.delivery_address || {}
    const phone = addr.telNumber || addr.phone || ''

    console.log(`[物流] 请求快递100: com=${kd100Com}, num=${trackingNumber}`)

    const kd100Res = await queryKD100(kd100Com, trackingNumber, phone)

    // ========== 6. 处理返回结果 ==========
    if (kd100Res.status === '200' && kd100Res.data && kd100Res.data.length > 0) {
      // 查询成功，缓存结果
      const cacheData = {
        state: kd100Res.state,
        data: kd100Res.data.map(item => ({
          time: item.time || item.ftime || '',
          context: item.context || '',
          areaName: item.areaName || '',
          areaCenter: item.areaCenter || ''
        }))
      }

      // 异步写缓存（不阻塞返回）
      db.collection('shopping_orders').doc(order_id).update({
        data: {
          logistics_cache: cacheData,
          logistics_last_query: db.serverDate()
        }
      }).catch(e => console.warn('[物流] 写缓存失败:', e))

      return {
        success: true,
        isCache: false,
        carrier: carrierCode,
        carrierName: getCarrierName(carrierCode),
        trackingNumber,
        state: kd100Res.state,
        stateDesc: STATE_DESC[kd100Res.state] || '未知',
        data: cacheData.data
      }

    } else {
      // 查询失败或无数据
      const errMsg = kd100Res.message || '暂无物流信息'
      console.warn(`[物流] 快递100返回异常: status=${kd100Res.status}, msg=${errMsg}`)

      // 如果有旧缓存，降级返回旧数据
      if (order.logistics_cache && order.logistics_cache.data && order.logistics_cache.data.length > 0) {
        return {
          success: true,
          isCache: true,
          cacheAge: -1,
          carrier: carrierCode,
          carrierName: getCarrierName(carrierCode),
          trackingNumber,
          state: order.logistics_cache.state,
          stateDesc: STATE_DESC[order.logistics_cache.state] || '未知',
          data: order.logistics_cache.data,
          notice: '快递信息更新延迟，展示上次查询结果'
        }
      }

      return {
        success: false,
        message: '卖家已填写快递单号，快递员可能正在揽收或数据更新延迟，请1小时后再试',
        carrier: carrierCode,
        trackingNumber
      }
    }

  } catch (err) {
    console.error('[getLogisticsTrack] 异常:', err)
    return { success: false, message: err.message || '查询失败' }
  }
}

function getCarrierName(code) {
  const names = {
    SF: '顺丰速运', YTO: '圆通快递', ZTO: '中通快递',
    STO: '申通快递', YUNDA: '韵达快递', JD: '京东快递',
    EMS: 'EMS邮政', OTHER: '其他快递'
  }
  return names[code] || code
}
