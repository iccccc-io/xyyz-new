const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const DIFY_API_KEY = 'app-aQpRb3BWhOCEMNrk5UTNCZqI'

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { success: false, message: '用户身份验证失败' }
  }

  const { action } = event

  try {
    switch (action) {
      case 'send':
        return await handleSend(event, openid)
      case 'clear':
        return await handleClear(event)
      default:
        return { success: false, message: '未知操作' }
    }
  } catch (err) {
    console.error('[ai_chat_proxy] 未捕获异常:', err)
    return { success: false, message: '服务异常，请稍后重试' }
  }
}

async function handleSend(event, openid) {
  const { query, conversation_id, inputs } = event

  if (!query || !conversation_id) {
    return { success: false, message: '缺少必要参数' }
  }

  let difyConvId = ''
  try {
    const lastMsg = await db.collection('ai_chat_history')
      .where({
        conversation_id,
        role: 'assistant',
        dify_conversation_id: _.exists(true)
      })
      .orderBy('create_time', 'desc')
      .limit(1)
      .get()

    if (lastMsg.data.length > 0 && lastMsg.data[0].dify_conversation_id) {
      difyConvId = lastMsg.data[0].dify_conversation_id
    }
  } catch (e) {
    console.warn('[ai_chat_proxy] 查询 dify_conversation_id 失败:', e)
  }

  let difyResult
  try {
    difyResult = await callDifyChat({
      query,
      user: openid,
      conversation_id: difyConvId,
      inputs: inputs || {}
    })
  } catch (err) {
    console.error('[ai_chat_proxy] Dify API 调用失败:', err)
    return { success: false, message: '网络开小差了，大师正在重新连线，请稍后再试。' }
  }

  // 解析 Dify 结构化输出：answer 可能是 JSON 字符串，也可能是纯文本
  const structured = parseStructuredOutput(difyResult.answer)

  try {
    await db.collection('ai_chat_history').add({
      data: {
        conversation_id,
        role: 'assistant',
        type: 'text',
        content: structured.answer,
        citations: structured.citations,
        suggested_questions: structured.suggested_questions,
        dify_conversation_id: difyResult.conversation_id || '',
        source_info: {
          scene: (inputs && inputs.source_scene) || '',
          name: (inputs && inputs.source_entity_name) || '',
          id: (inputs && inputs.source_entity_id) || ''
        },
        create_time: db.serverDate()
      }
    })
  } catch (e) {
    console.error('[ai_chat_proxy] AI 回复入库失败:', e)
  }

  return {
    success: true,
    answer: structured.answer,
    citations: structured.citations,
    suggested_questions: structured.suggested_questions,
    dify_conversation_id: difyResult.conversation_id || ''
  }
}

/**
 * 解析 Dify 的结构化输出
 * Dify 工作流开启结构化输出后，answer 字段为 JSON 字符串
 * 兼容旧版纯文本回复
 */
function parseStructuredOutput(rawAnswer) {
  if (!rawAnswer) {
    return { answer: '', citations: [], suggested_questions: [] }
  }

  // 尝试 JSON 解析
  try {
    const parsed = JSON.parse(rawAnswer)
    if (parsed && typeof parsed.answer === 'string') {
      return {
        answer: parsed.answer || '',
        citations: Array.isArray(parsed.citations) ? parsed.citations : [],
        suggested_questions: Array.isArray(parsed.suggested_questions) ? parsed.suggested_questions : []
      }
    }
  } catch (e) {
    // 非 JSON，走纯文本兜底
  }

  // 纯文本兜底（兼容旧版 Dify 配置）
  return {
    answer: rawAnswer,
    citations: [],
    suggested_questions: []
  }
}

async function handleClear(event) {
  const { conversation_id } = event

  if (!conversation_id) {
    return { success: false, message: '缺少会话标识' }
  }

  try {
    let totalRemoved = 0
    while (true) {
      const res = await db.collection('ai_chat_history')
        .where({ conversation_id })
        .remove()
      totalRemoved += res.stats.removed
      if (res.stats.removed === 0) break
    }
    console.log(`[ai_chat_proxy] 已清除 ${totalRemoved} 条记录`)
    return { success: true, deleted: totalRemoved }
  } catch (err) {
    console.error('[ai_chat_proxy] 清除失败:', err)
    return { success: false, message: '清除失败' }
  }
}

function callDifyChat({ query, user, conversation_id, inputs }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      query,
      user,
      inputs,
      response_mode: 'blocking',
      conversation_id: conversation_id || ''
    })

    const options = {
      hostname: 'api.dify.ai',
      port: 443,
      path: '/v1/chat-messages',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DIFY_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.error('[Dify] HTTP', res.statusCode, body.substring(0, 500))
          reject(new Error(`Dify API 响应异常: ${res.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(new Error('Dify 响应解析失败'))
        }
      })
    })

    req.on('error', (e) => {
      console.error('[Dify] 请求错误:', e)
      reject(e)
    })

    req.setTimeout(55000, () => {
      req.destroy()
      reject(new Error('Dify API 请求超时'))
    })

    req.write(payload)
    req.end()
  })
}
