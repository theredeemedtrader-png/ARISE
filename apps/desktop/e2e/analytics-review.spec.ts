import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('M12 Analytics distinguishes unavailable data and Review learning preserves exact versions across restart', async () => {
  test.setTimeout(90_000);
  const userData=await mkdtemp(path.join(tmpdir(),'arise-m12-'));const launch=()=>electron.launch({args:['.',`--user-data-dir=${userData}`]});let app:Awaited<ReturnType<typeof launch>>|undefined;
  try{
    app=await launch();let page=await app.firstWindow();
    const created=await page.evaluate(async()=>{
      const colony=await window.arise.createPlanningIdea({symbol:'EURUSD',timeframe:'D',direction:'LONG',thesisText:'Immutable M12 inception thesis',targetDescription:'Daily target',invalidationDescription:'Daily invalidation',primaryTargetMarketObjectVersionId:null,invalidationMarketObjectVersionId:null});
      const strategy=await window.arise.createStrategyDefinition({name:'M12 Review Strategy',category:'ENTRY',description:'Original playbook',tags:['review'],automationCapability:'MANUAL',deploymentStatus:'VALIDATED',detectorKey:'',detectorVersion:'1',evaluationMode:'MANUAL',parameterSchema:{}});
      let review=await window.arise.createPerformanceReview({sourceType:'COLONY',sourceId:colony.colonyId,title:'First Colony Dissection',dissection:{thesis:'The inception thesis remained explicit.',decision:'Participation criteria were reviewed.',management:'Position-level management stayed separate.',outcome:'No outcome was inferred without fills.',lesson:'Require complete evidence before judging outcome.'},evidenceEventIds:[]});
      review=await window.arise.createLesson({reviewId:review.reviews[0]!.id,statement:'Require complete evidence before judging outcome.'});
      const lessonId=review.lessons[0]!.id;
      review=await window.arise.advanceLesson({lessonId,status:'REPEATED_PATTERN'});
      review=await window.arise.advanceLesson({lessonId,status:'PLAYBOOK_RULE'});
      review=await window.arise.createStrategyChangeProposal({lessonId,strategyVersionId:strategy.versionId,proposedChange:'Require an evidence-integrity check in review.',expectedEffect:'Prevent conclusions from missing evidence.',testRequirements:'Compare complete and missing-evidence cases.'});
      review=await window.arise.acceptStrategyChangeProposal({proposalId:review.proposals[0]!.id});
      return {colony,strategy,review,analytics:await window.arise.getAnalyticsWorkspace()};
    });
    expect(created.analytics.overall).toMatchObject({positionCount:0,realizedPips:{status:'AVAILABLE',value:0},millipedeEfficiency:{status:'UNAVAILABLE'}});
    expect(created.review.lessons[0]?.currentVersion.status).toBe('PLAYBOOK_RULE');
    expect(created.review.proposals[0]).toMatchObject({status:'ACCEPTED',sourceStrategyVersionId:created.strategy.versionId});

    await page.getByRole('button',{name:'Settings'}).first().click();await page.getByRole('button',{name:'$ HIDDEN',exact:true}).click();
    await page.getByRole('button',{name:'Analytics'}).first().click();await expect(page.getByRole('heading',{name:'Analytics'})).toBeVisible();await expect(page.getByTestId('money-hidden-notice')).toBeVisible();await expect(page.getByRole('button',{name:'MONEY',exact:true})).toBeDisabled();await expect(page.getByText('UNAVAILABLE').first()).toBeVisible();
    await page.getByRole('button',{name:'Review'}).first().click();await page.getByRole('button',{name:'REVIEW LAB'}).click();await expect(page.getByText('First Colony Dissection')).toBeVisible();await expect(page.getByText('Require complete evidence before judging outcome.')).toBeVisible();await expect(page.getByText('ACCEPTED')).toBeVisible();
    await app.close();app=undefined;app=await launch();page=await app.firstWindow();
    const restored=await page.evaluate(async()=>({review:await window.arise.getPerformanceReviewWorkspace(),strategies:await window.arise.getStrategyWorkspace()}));
    expect(restored.review.reviews[0]?.ideaVersion).toMatchObject({id:created.colony.ideaVersionId,direction:'LONG'});expect(restored.review.proposals[0]?.status).toBe('ACCEPTED');
    const versions=restored.strategies.strategies.filter((item)=>item.definitionId===created.strategy.definitionId);expect(versions[0]).toMatchObject({versionNo:2,deploymentStatus:'EXPERIMENTAL'});
  }finally{await app?.close();await rm(userData,{recursive:true,force:true});}
});
