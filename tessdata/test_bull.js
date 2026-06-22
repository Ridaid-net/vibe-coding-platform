process.chdir('/home/claude/rodaid-api')
require('./node_modules/dotenv').config()
const {getRedis,pingRedis,closeRedis}=require('./dist/config/redis')
const {initBullMQ,closeBullMQ,encolarValidacion,encolarNotificacion,getQueueStats,Q}=require('./dist/services/bull.service')
const {pool,query,queryOne}=require('./dist/config/database')

async function run(){
  let ok=0,fail=0
  const chk=(label,cond,detail='')=>{ cond?ok++:fail++; console.log((cond?'  \u2713':'  \u2717'),label+(detail?' \u00b7 '+detail:'')); return cond }

  console.log('\n== 1. Redis ==')
  getRedis()
  await new Promise(r=>setTimeout(r,500))
  const alive=await pingRedis()
  chk('Redis ping', alive)

  console.log('\n== 2. BullMQ init ==')
  await initBullMQ()
  const qs=await getQueueStats()
  chk('4 queues', Object.keys(qs).length===4, Object.keys(qs).join(' '))
  chk('stats structure', 'waiting' in Object.values(qs)[0])

  console.log('\n== 3. Notificacion worker ==')
  await encolarNotificacion({usuarioId:'20000000-0000-0000-0000-000000000002',tipo:'CIT_APROBADO',titulo:'TestBull notif',cuerpo:'Queue test BullMQ',datos:{bull:true}})
  await new Promise(r=>setTimeout(r,2000))
  const notif=await query("SELECT id FROM notificaciones WHERE titulo='TestBull notif' LIMIT 1")
  chk('notif saved in DB', notif.length>0)

  console.log('\n== 4. Validacion worker (delay 1s) ==')
  // Reset Specialized Rockhopper to PENDIENTE
  await query("DELETE FROM validacion_queue WHERE cit_id='50000000-0000-0000-0000-000000000002'")
  await query("UPDATE cits SET estado='PENDIENTE',bfa_tx_hash=NULL,nft_token_id=NULL,fecha_emision=NULL,fecha_vencimiento=NULL WHERE id='50000000-0000-0000-0000-000000000002'")
  await query("INSERT INTO validacion_queue (cit_id,serial_bicicleta,propietario_dni,propietario_nombre,propietario_datos,vence_en) VALUES ('50000000-0000-0000-0000-000000000002','SN-9923410056-MZA','30123456','Federico De Gea','{}',NOW()+INTERVAL '72 hours') ON CONFLICT DO NOTHING")

  const jobId=await encolarValidacion('50000000-0000-0000-0000-000000000002','SN-9923410056-MZA',new Date(Date.now()+1000))
  chk('jobId generado', !!jobId, jobId)

  // Esperar que el worker valide + finalice el CIT
  console.log('  Esperando procesamiento del worker (5s)...')
  await new Promise(r=>setTimeout(r,5000))

  const cit=await queryOne("SELECT estado,nft_token_id,bfa_tx_hash FROM cits WHERE id='50000000-0000-0000-0000-000000000002'")
  chk('CIT=ACTIVO (worker completo)', cit?.estado==='ACTIVO', cit?.estado||'?')
  chk('nft_token_id asignado', cit?.nft_token_id!=null, String(cit?.nft_token_id))
  chk('bfa_tx_hash (0x...)', cit?.bfa_tx_hash?.startsWith('0x'), cit?.bfa_tx_hash?.slice(0,24)+'...')

  console.log('\n== 5. Stats post-ejecucion ==')
  const qs2=await getQueueStats()
  const vc=qs2['validar-cit']
  const fc=qs2['finalizar-cit']
  chk('validar completed>=1', vc.completed>=1, JSON.stringify(vc))
  chk('finalizar completed>=1', fc.completed>=1, JSON.stringify(fc))
  chk('sin jobs fallidos', vc.failed===0 && fc.failed===0, `v.fail=${vc.failed} f.fail=${fc.failed}`)

  console.log('\n== 6. Idempotencia ==')
  const j2=await encolarValidacion('50000000-0000-0000-0000-000000000002','SN-9923410056-MZA',new Date(Date.now()+5000))
  chk('jobId no-null (idempotente)', !!j2, j2)

  console.log('\n== 7. Cron jobs ==')
  const {Queue}=require('bullmq')
  const mq=new Queue('mantenimiento',{connection:getRedis()})
  const repeatable=await mq.getRepeatableJobs()
  await mq.close()
  chk('cron expirar_cits', repeatable.some(j=>j.name&&j.name.includes('expirar')), repeatable.map(j=>j.name).join(','))
  chk('cron limpiar_tokens', repeatable.some(j=>j.name&&j.name.includes('limpiar')))

  await closeBullMQ()
  await closeRedis()
  await pool.end()

  console.log('\n====================================================')
  console.log('  '+ok+'/'+(ok+fail)+' tests ' + (fail===0?'\u2713 TODOS PASARON':'\u2717 '+fail+' FALLOS'))
  console.log('====================================================')
  process.exit(fail>0?1:0)
}
run().catch(e=>{console.error('FATAL:',e.message);process.exit(1)})
