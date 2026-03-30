const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const TEXT_SEC_SCENE = 3
const IMAGE_SEC_SCENE = 3
const RENAME_LIMIT_DAYS = 30

function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isCloudFileId(value) {
  return typeof value === 'string' && value.startsWith('cloud://')
}

function normalizeCertificates(list) {
  return (Array.isArray(list) ? list : []).filter(isCloudFileId)
}

async function checkTextSecurity(text, openid, message) {
  const content = getSafeString(text)
  if (!content) return

  try {
    const res = await cloud.openapi.security.msgSecCheck({
      openid,
      scene: TEXT_SEC_SCENE,
      version: 2,
      content
    })

    if ((res && res.errCode && res.errCode !== 0) || (res && res.result && res.result.label !== 0)) {
      throw new Error(message)
    }
  } catch (err) {
    if (err && (err.errCode === 87014 || err.errCode === 40001 || /敏感|risky/i.test(err.errMsg || ''))) {
      throw new Error(message)
    }
    console.error('[apply_certification] 文本安全校验失败:', err)
    throw new Error('内容安全校验失败，请稍后重试')
  }
}

async function checkImagesSecurity(fileIds, openid, message) {
  const cloudFileIds = (Array.isArray(fileIds) ? fileIds : []).filter(isCloudFileId)
  if (!cloudFileIds.length) return

  try {
    const tempRes = await cloud.getTempFileURL({
      fileList: cloudFileIds
    })
    const tempUrls = (tempRes.fileList || [])
      .map((item) => item && item.tempFileURL)
      .filter(Boolean)

    for (const mediaUrl of tempUrls) {
      const res = await cloud.openapi.security.mediaCheckAsync({
        openid,
        scene: IMAGE_SEC_SCENE,
        version: 2,
        mediaType: 2,
        mediaUrl
      })

      if ((res && res.errCode && res.errCode !== 0) || (res && res.result && res.result.label !== 0)) {
        throw new Error(message)
      }
    }
  } catch (err) {
    if (err && (err.errCode === 87014 || err.errCode === 20001 || /risky|敏感/i.test(err.errMsg || ''))) {
      throw new Error(message)
    }
    console.error('[apply_certification] 图片安全校验失败:', err)
    throw new Error('图片安全校验失败，请稍后重试')
  }
}

async function ensureWorkshopNameUnique(name) {
  const countRes = await db.collection('shopping_workshops')
    .where({ name })
    .count()

  if ((countRes.total || 0) > 0) {
    throw new Error('工坊名称已被使用，请更换一个名字')
  }
}

function validatePayload(payload) {
  const realName = getSafeString(payload.real_name)
  const ichCategory = getSafeString(payload.ich_category)
  const workshopName = getSafeString(payload.workshop_name)
  const workshopLogo = getSafeString(payload.workshop_logo)
  const workshopDesc = getSafeString(payload.workshop_desc)
  const certificates = normalizeCertificates(payload.certificates)

  if (!realName || !ichCategory || !workshopName || !workshopLogo || !workshopDesc) {
    throw new Error('真实姓名、非遗类别、工坊名称、工坊 Logo 和主理人寄语均为必填项')
  }

  if (realName.length < 2 || realName.length > 20) {
    throw new Error('真实姓名需控制在 2-20 个字之间')
  }
  if (workshopName.length < 2 || workshopName.length > 20) {
    throw new Error('工坊名称需控制在 2-20 个字之间')
  }
  if (workshopDesc.length < 10 || workshopDesc.length > 300) {
    throw new Error('主理人寄语需控制在 10-300 个字之间')
  }
  if (!certificates.length) {
    throw new Error('请至少上传一张证书图片')
  }

  return {
    realName,
    ichCategory,
    workshopName,
    workshopLogo,
    workshopDesc,
    certificates
  }
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext()

  try {
    const payload = validatePayload(event)
    const userRes = await db.collection('users')
      .where({ _openid: openid })
      .limit(1)
      .get()

    if (!userRes.data || !userRes.data.length) {
      return {
        success: false,
        message: '用户信息不存在，请先完成登录'
      }
    }

    const user = userRes.data[0]
    if (user.is_certified) {
      return {
        success: false,
        message: '您已通过认证，无需重复申请'
      }
    }

    await ensureWorkshopNameUnique(payload.workshopName)
    await checkTextSecurity(payload.realName, openid, '真实姓名包含敏感信息，请修改后重试')
    await checkTextSecurity(payload.workshopName, openid, '工坊名称包含敏感信息，请修改后重试')
    await checkTextSecurity(payload.workshopDesc, openid, '主理人寄语包含敏感信息，请修改后重试')
    await checkImagesSecurity([payload.workshopLogo], openid, '工坊图片未通过审核，请更换后重试')
    await checkImagesSecurity(payload.certificates, openid, '证书图片未通过审核，请更换后重试')

    const now = db.serverDate()
    const applyRes = await db.collection('apply_records').add({
      data: {
        user_id: user._id,
        openid,
        real_name: payload.realName,
        ich_category: payload.ichCategory,
        certificates: payload.certificates,
        workshop_name: payload.workshopName,
        workshop_logo: payload.workshopLogo,
        workshop_desc: payload.workshopDesc,
        status: 'approved',
        create_time: now,
        approve_time: now
      }
    })

    const workshopRes = await db.collection('shopping_workshops').add({
      data: {
        owner_id: openid,
        owner_openid: openid,
        member_ids: [openid],
        name: payload.workshopName,
        logo: payload.workshopLogo,
        cover_url: '',
        desc: payload.workshopDesc,
        last_rename_time: null,
        real_name: payload.realName,
        ich_category: payload.ichCategory,
        workshop_tags: payload.ichCategory ? [payload.ichCategory] : [],
        product_count: 0,
        total_sales: 0,
        rating: 0,
        shop_rating: 0,
        shop_review_count: 0,
        rating_details: {
          service: 0,
          logistics: 0,
          quality: 0
        },
        create_time: now,
        update_time: now
      }
    })

    await db.collection('users')
      .where({ _openid: openid })
      .update({
        data: {
          is_certified: true,
          real_name: payload.realName,
          ich_category: payload.ichCategory,
          workshop_id: workshopRes._id,
          update_time: now
        }
      })

    return {
      success: true,
      message: '认证成功，系统已为您创建工坊',
      workshop_id: workshopRes._id,
      workshop_name: payload.workshopName,
      apply_record_id: applyRes._id,
      rename_limit_days: RENAME_LIMIT_DAYS
    }
  } catch (err) {
    console.error('[apply_certification]', err)
    return {
      success: false,
      message: err.message || '认证申请失败，请稍后重试'
    }
  }
}
