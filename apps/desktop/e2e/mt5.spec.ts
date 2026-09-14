import { _electron as electron,expect,test } from '@playwright/test';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ReadOnlyMt5AgentServer } from '@arise/mt5-agent';
import { mt5SnapshotSchema } from '@arise/shared';

const stamp=()=>new Date().toISOString();
const makeSnapshot=()=>mt5SnapshotSchema.parse({snapshotId:randomUUID(),complete:true,capturedAt:stamp(),account:{accountKey:'fake:demo-1001',broker:'Fake MT5',server:'Harness',login:'1001',currency:'USD',balance:10000,equity:10005,margin:25,freeMargin:9980,leverage:100,isLive:false,hedging:true,capturedAt:stamp()},symbols:[{brokerSymbol:'EURUSD.a',canonicalSymbol:'EURUSD',digits:5,tickSize:.00001,pipSize:.0001,contractSize:100000,minVolume:.01,volumeStep:.01,maxVolume:100,stopsLevel:0,freezeLevel:0}],positions:[{brokerPositionKey:'ticket-9001',brokerSymbol:'EURUSD.a',direction:'LONG',volume:.1,openPrice:1.1,currentPrice:1.102,stopLoss:null,takeProfit:null,openedAt:stamp(),magic:0,comment:'manual'}],pendingOrders:[{brokerOrderKey:'order-9002',brokerSymbol:'EURUSD.a',orderType:'BUY_LIMIT',direction:'LONG',volume:.05,price:1.09,stopLoss:null,takeProfit:null,placedAt:stamp(),magic:0,comment:'external'}],quotes:[{brokerSymbol:'EURUSD.a',bid:1.102,ask:1.1021,brokerTime:stamp(),receivedAt:stamp(),sequence:10}],candles:[{brokerSymbol:'EURUSD.a',timeframe:'M5',openTime:'2026-09-11T12:00:00.000Z',closeTime:'2026-09-11T12:05:00.000Z',open:1.1,high:1.103,low:1.099,close:1.102,tickVolume:50,origin:'RECOVERED'}],unavailableReason:null});
const makeAgent=()=>new ReadOnlyMt5AgentServer({mode:'FAKE_HARNESS',terminalConnected:()=>true,snapshot:makeSnapshot});

test('M9 fake Agent disconnect enters UNKNOWN and reconnects to broker truth',async()=>{
  const userData=await mkdtemp(path.join(tmpdir(),'arise-mt5-reconnect-'));const agent=makeAgent();const address=await agent.start();const app=await electron.launch({args:['.',`--user-data-dir=${userData}`],env:{...process.env,ARISE_MT5_ENDPOINT:`${address.host}:${address.port}`}});
  try{
    const page=await app.firstWindow();
    await page.getByRole('button',{name:'System Health',exact:true}).click();
    await expect(page.getByText('FAKE_HARNESS')).toBeVisible();
    await expect(page.getByText('BROKER REALITY VERIFIED',{exact:true})).toBeVisible();
    await agent.stop();
    await expect(page.getByText('RECOVERY REQUIRED')).toBeVisible();
    await agent.start();
    await expect(page.getByText('BROKER REALITY VERIFIED',{exact:true})).toBeVisible();
  } finally{await app.close();await agent.stop();await rm(userData,{recursive:true,force:true});}
});

test('M9 broker mirror and external classification survive Desktop restart',async()=>{
  const userData=await mkdtemp(path.join(tmpdir(),'arise-mt5-restart-'));const agent=makeAgent();const address=await agent.start();const launch=()=>electron.launch({args:['.',`--user-data-dir=${userData}`],env:{...process.env,ARISE_MT5_ENDPOINT:`${address.host}:${address.port}`}});let app:Awaited<ReturnType<typeof launch>>|undefined;
  try{app=await launch();let page=await app.firstWindow();await page.locator('.primary-nav').getByRole('button',{name:'Positions',exact:true}).click();const card=page.getByTestId('broker-position-ticket-9001');await expect(card).toContainText('UNCLASSIFIED');await card.getByRole('button',{name:'TRACK EXTERNAL'}).click();await expect(card).toContainText('TRACK_AS_EXTERNAL');await expect(page.getByText('order-9002')).toBeVisible();await app.close();app=undefined;app=await launch();page=await app.firstWindow();await page.locator('.primary-nav').getByRole('button',{name:'Positions',exact:true}).click();await expect(page.getByTestId('broker-position-ticket-9001')).toContainText('TRACK_AS_EXTERNAL');await expect(page.getByText('1.10200')).toBeVisible();}
  finally{await app?.close();await agent.stop();await rm(userData,{recursive:true,force:true});}
});
