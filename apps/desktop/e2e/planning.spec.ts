import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('M5 planning, knowledge, and explicit review history persist across restart', async () => {
  test.setTimeout(90_000);
  const userData = await mkdtemp(path.join(tmpdir(), 'arise-m5-'));
  const launch = () => electron.launch({ args: ['.', `--user-data-dir=${userData}`] });
  let app: Awaited<ReturnType<typeof launch>> | undefined;

  try {
    app = await launch();
    let page = await app.firstWindow();

    await page.getByRole('button', { name: 'Ideas' }).first().click();
    await expect(page.getByRole('heading', { name: 'Ideas' })).toBeVisible();
    await page.getByRole('button', { name: /New Idea/ }).click();
    await expect(page.getByText('Start a Thesis')).toBeVisible();
    await page.getByLabel('Instrument').selectOption({ label: 'EURUSD' });
    await page.getByLabel('Thesis timeframe').selectOption({ label: 'D' });
    await page.getByLabel('Direction').selectOption('LONG');
    await page.getByRole('textbox', { name: 'Thesis', exact: true }).fill('Daily sweep supports continuation toward external liquidity.');
    await page.getByLabel('Target').fill('Weekly external liquidity');
    await page.getByLabel('Invalidation').fill('Daily close below protected low');
    await page.getByRole('button', { name: 'Create Idea + Colony' }).click();

    await expect(page.locator('.idea-card-title')).toHaveText('EURUSD · D LONG #01');
    await expect(page.getByText(/VERSION 1/)).toBeVisible();
    const editor = page.locator('.thesis-editor');
    await editor.fill('Updated daily thesis [[Liquidity Playbook]]');
    await page.getByRole('button', { name: 'Save Thesis v2' }).click();
    await expect(page.getByText(/VERSION 2/)).toBeVisible();

    const knowledge = await page.evaluate(async () => {
      const playbook = await window.arise.createKnowledgeDocument({
        title: 'Liquidity Playbook', documentType: 'RESEARCH', text: 'External liquidity notes', primaryFolderId: null,
      });
      const journal = await window.arise.createKnowledgeDocument({
        title: 'Daily Context', documentType: 'NOTE', text: 'See [[Liquidity Playbook]]', primaryFolderId: null,
      });
      const playbookDetail = await window.arise.getKnowledgeDocument({ documentId: playbook.id });
      return { playbook, journal, playbookDetail };
    });
    expect(knowledge.playbookDetail.backlinks.some((entry) => entry.title === 'Daily Context')).toBe(true);

    await page.getByRole('button', { name: 'Knowledge' }).first().click();
    await expect(page.getByRole('heading', { name: 'Knowledge' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Liquidity Playbook/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Daily Context/ })).toBeVisible();

    const review = await page.evaluate(async () => {
      const schedule = await window.arise.createReviewSchedule({ symbol: 'EURUSD', timeframe: 'D', frequencyType: 'EVERY_CANDLE' });
      const due = await window.arise.queueReviewNow({ scheduleId: schedule.id });
      if (due.status !== 'DUE' || due.direction !== 'UNCHANGED') throw new Error('Manual queue must begin DUE/UNCHANGED');
      return window.arise.resolveMarketReview({ reviewId: due.reviewId, status: 'COMPLETED', direction: 'LONG', notes: 'Daily thesis remains valid.' });
    });
    expect(review.status).toBe('COMPLETED');
    expect(review.direction).toBe('LONG');
    expect(review.ideaVersionId).not.toBeNull();
    expect(review.notesDocumentId).not.toBeNull();

    await page.getByRole('button', { name: 'Review' }).first().click();
    await expect(page.getByRole('heading', { name: 'Market Review' })).toBeVisible();
    await expect(page.getByText('Candle-close automation is deliberately waiting for TimeframeService.')).toBeVisible();
    await expect(page.getByText('Provider not configured')).toBeVisible();

    await app.close();
    app = undefined;
    app = await launch();
    page = await app.firstWindow();

    const restored = await page.evaluate(async () => ({
      ideas: await window.arise.listPlanningIdeas(),
      library: await window.arise.getKnowledgeLibrary(),
      review: await window.arise.getReviewWorkspace(),
    }));
    const idea = restored.ideas.find((entry) => entry.symbol === 'EURUSD' && entry.timeframe === 'D');
    expect(idea?.versionNo).toBe(2);
    expect(idea?.thesisText).toContain('[[Liquidity Playbook]]');
    expect(restored.library.documents.some((entry) => entry.title === 'Liquidity Playbook')).toBe(true);
    expect(restored.review.queue.some((entry) => entry.status === 'COMPLETED' && entry.direction === 'LONG')).toBe(true);
    expect(restored.review.automaticTimingAvailable).toBe(false);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
