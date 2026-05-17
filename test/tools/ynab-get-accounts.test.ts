import { describe, it, expect } from 'vitest';
import type * as ynab from 'ynab';
import { createYnabExtension } from '../../src/index.js';
import { createMockExtensionAPI, createMockYnabAPI, getTools } from '../test-helpers.js';

function makeAccount(overrides: Partial<ynab.Account> = {}): ynab.Account {
  return {
    id: 'acc-1',
    name: 'Checking',
    type: 'checking',
    on_budget: true,
    closed: false,
    balance: 1234560,
    cleared_balance: 1200000,
    uncleared_balance: 34560,
    transfer_payee_id: 'payee-1',
    deleted: false,
    ...overrides
  };
}

describe('ynab_get_accounts', () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const extApi = createMockExtensionAPI();
    createYnabExtension({ ynabAPI, defaultBudgetId: 'budget-123' })(extApi);
    return { ynabAPI, tool: getTools(extApi).find(t => t.name === 'ynab_get_accounts')! };
  }

  it('lists open on-budget accounts by default', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: {
        accounts: [
          makeAccount({ name: 'Checking', balance: 1234560 }),
          makeAccount({ id: 'acc-2', name: 'Brokerage', type: 'otherAsset', on_budget: false, balance: 5000000 }),
          makeAccount({ id: 'acc-3', name: 'Old Card', type: 'creditCard', closed: true, balance: 0 }),
          makeAccount({ id: 'acc-4', name: 'Deleted', deleted: true, balance: 0 })
        ]
      }
    });

    const result = await tool.execute('call-1', {});

    expect(ynabAPI.accounts.getAccounts).toHaveBeenCalledWith('budget-123');
    expect(result.content[0].text).toContain('Showing 1 of 4');
    expect(result.content[0].text).toContain('Checking');
    expect(result.content[0].text).toContain('Balance: $1,234.56 USD');
    expect(result.content[0].text).not.toContain('Brokerage');
    expect(result.content[0].text).not.toContain('Old Card');
    expect(result.content[0].text).not.toContain('Deleted');
  });

  it('can include off-budget accounts and labels them clearly', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: {
        accounts: [
          makeAccount({ name: 'Checking', balance: 100000 }),
          makeAccount({ id: 'acc-2', name: 'Brokerage', type: 'otherAsset', on_budget: false, balance: 5000000 })
        ]
      }
    });

    const result = await tool.execute('call-1', { includeOffBudget: true });

    expect(result.content[0].text).toContain('Checking | checking | on budget');
    expect(result.content[0].text).toContain('Brokerage | otherAsset | off budget');
    expect(result.content[0].text).toContain('On-budget total: $100.00 USD');
  });

  it('includes direct import and reconciliation details in verbose mode', async () => {
    const { ynabAPI, tool } = setup();
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: {
        accounts: [
          makeAccount({
            direct_import_linked: true,
            direct_import_in_error: true,
            last_reconciled_at: '2026-05-15T12:00:00Z'
          })
        ]
      }
    });

    const result = await tool.execute('call-1', { verbose: true });

    expect(result.content[0].text).toContain('Direct import: linked | Import health: error | Last reconciled: 2026-05-15T12:00:00Z');
  });
});
