import { describe, it, expect } from 'vitest';
import { createYnabExtension } from '../../src/index.js';
import { createMockYnabAPI, createMockExtensionAPI, getTools, makePayee } from '../test-helpers.js';

describe('ynab_payees_list', () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const extApi = createMockExtensionAPI();
    createYnabExtension({ ynabAPI, defaultBudgetId: 'budget-123' })(extApi);
    const tool = getTools(extApi).find(t => t.name === 'ynab_payees_list')!;
    return { ynabAPI, tool };
  }

  it('excludes transfer and deleted payees by default', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: {
        payees: [
          makePayee({ id: 'pay-1', name: 'Grocery Store' }),
          makePayee({ id: 'pay-2', name: 'Amazon' }),
          makePayee({ id: 'pay-3', name: 'Transfer : Savings', transfer_account_id: 'acc-2' }),
          makePayee({ id: 'pay-4', name: 'Old Vendor', deleted: true })
        ]
      }
    });

    const result = await tool.execute('call-1', {});

    expect(result.content[0].text).toContain('showing 2 of 4');
    expect(result.content[0].text).toContain('Grocery Store');
    expect(result.content[0].text).toContain('Amazon');
    expect(result.content[0].text).not.toContain('Transfer : Savings');
    expect(result.content[0].text).not.toContain('Old Vendor');
  });

  it('includes transfers when requested', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: {
        payees: [
          makePayee({ id: 'pay-1', name: 'Grocery Store' }),
          makePayee({ id: 'pay-2', name: 'Transfer : Savings', transfer_account_id: 'acc-2' })
        ]
      }
    });

    const result = await tool.execute('call-1', { includeTransfers: true });

    expect(result.content[0].text).toContain('showing 2 of 2');
    expect(result.content[0].text).toContain('Transfer : Savings');
    expect(result.content[0].text).toContain('transfer');
  });

  it('includes deleted payees when requested', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: {
        payees: [
          makePayee({ id: 'pay-1', name: 'Grocery Store' }),
          makePayee({ id: 'pay-2', name: 'Old Vendor', deleted: true })
        ]
      }
    });

    const result = await tool.execute('call-1', { includeDeleted: true });

    expect(result.content[0].text).toContain('showing 2 of 2');
    expect(result.content[0].text).toContain('Old Vendor');
    expect(result.content[0].text).toContain('deleted');
  });

  it('shows payee names and IDs', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: {
        payees: [
          makePayee({ id: 'pay-42', name: 'Costco' })
        ]
      }
    });

    const result = await tool.execute('call-1', {});

    expect(result.content[0].text).toContain('Costco');
    expect(result.content[0].text).toContain('id: pay-42');
  });

  it('sorts payees alphabetically', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: {
        payees: [
          makePayee({ id: 'pay-3', name: 'Zebra' }),
          makePayee({ id: 'pay-1', name: 'Alpha' }),
          makePayee({ id: 'pay-2', name: 'Bravo' })
        ]
      }
    });

    const result = await tool.execute('call-1', {});

    const text = result.content[0].text;
    const alphaIndex = text.indexOf('Alpha');
    const bravoIndex = text.indexOf('Bravo');
    const zebraIndex = text.indexOf('Zebra');
    expect(alphaIndex).toBeLessThan(bravoIndex);
    expect(bravoIndex).toBeLessThan(zebraIndex);
  });

  it('handles budget not found error', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.payees.getPayees.mockRejectedValue({
      error: { id: '404', name: 'not_found', detail: 'Budget not found' }
    });

    const result = await tool.execute('call-1', { budgetId: 'unknown' });

    expect(result.content[0].text).toContain('Budget "unknown" not found');
  });

  it('handles empty payees list gracefully', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: { payees: [] }
    });

    const result = await tool.execute('call-1', {});

    expect(result.content[0].text).toContain('showing 0 of 0');
    expect(result.content[0].text).toContain('no payees match');
  });

  it('passes budgetId to resolveBudgetId when not provided', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.payees.getPayees.mockResolvedValue({
      data: { payees: [] }
    });

    await tool.execute('call-1', {});

    expect(ynabAPI.payees.getPayees).toHaveBeenCalledWith('budget-123');
  });
});
