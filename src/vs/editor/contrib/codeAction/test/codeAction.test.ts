/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { Range } from 'vs/editor/common/core/range';
import { TextModel } from 'vs/editor/common/model/textModel';
import * as modes from 'vs/editor/common/modes';
import { getCodeActions } from 'vs/editor/contrib/codeAction/codeAction';
import { CodeActionKind, CodeActionTriggerType } from 'vs/editor/contrib/codeAction/types';
import { IMarkerData, MarkerSeverity } from 'vs/platform/markers/common/markers';
import { CancellationToken } from 'vs/base/common/cancellation';

function staticCodeActionProvider(...actions: modes.CodeAction[]): modes.CodeActionProvider {
	return new class implements modes.CodeActionProvider {
		provideCodeActions(): modes.CodeActionList {
			return {
				actions: actions,
				dispose: () => { }
			};
		}
	};
}


suite('CodeAction', () => {

	let langId = new modes.LanguageIdentifier('fooLang', 17);
	let uri = URI.parse('untitled:path');
	let model: TextModel;
	const disposables = new DisposableStore();
	let testData = {
		diagnostics: {
			abc: {
				title: 'bTitle',
				diagnostics: [{
					startLineNumber: 1,
					startColumn: 1,
					endLineNumber: 2,
					endColumn: 1,
					severity: MarkerSeverity.Error,
					message: 'abc'
				}]
			},
			bcd: {
				title: 'aTitle',
				diagnostics: [{
					startLineNumber: 1,
					startColumn: 1,
					endLineNumber: 2,
					endColumn: 1,
					severity: MarkerSeverity.Error,
					message: 'bcd'
				}]
			}
		},
		command: {
			abc: {
				command: new class implements modes.Command {
					id!: '1';
					title!: 'abc';
				},
				title: 'Extract to inner function in function "test"'
			}
		},
		spelling: {
			bcd: {
				diagnostics: <IMarkerData[]>[],
				edit: new class implements modes.WorkspaceEdit {
					edits!: modes.ResourceTextEdit[];
				},
				title: 'abc'
			}
		},
		tsLint: {
			abc: {
				$ident: 57,
				arguments: <IMarkerData[]>[],
				id: '_internal_command_delegation',
				title: 'abc'
			},
			bcd: {
				$ident: 47,
				arguments: <IMarkerData[]>[],
				id: '_internal_command_delegation',
				title: 'bcd'
			}
		}
	};

	setup(function () {
		disposables.clear();
		model = TextModel.createFromString('test1\ntest2\ntest3', undefined, langId, uri);
		disposables.add(model);
	});

	teardown(function () {
		disposables.clear();
	});

	test('CodeActions are sorted by type, #38623', async function () {

		const provider = staticCodeActionProvider(
			testData.command.abc,
			testData.diagnostics.bcd,
			testData.spelling.bcd,
			testData.tsLint.bcd,
			testData.tsLint.abc,
			testData.diagnostics.abc
		);

		disposables.add(modes.CodeActionProviderRegistry.register('fooLang', provider));

		const expected = [
			// CodeActions with a diagnostics array are shown first ordered by diagnostics.message
			testData.diagnostics.abc,
			testData.diagnostics.bcd,

			// CodeActions without diagnostics are shown in the given order without any further sorting
			testData.command.abc,
			testData.spelling.bcd, // empty diagnostics array
			testData.tsLint.bcd,
			testData.tsLint.abc
		];

		const { validActions: actions } = await getCodeActions(model, new Range(1, 1, 2, 1), { type: CodeActionTriggerType.Manual }, CancellationToken.None);
		assert.equal(actions.length, 6);
		assert.deepEqual(actions, expected);
	});

	test('getCodeActions should filter by scope', async function () {
		const provider = staticCodeActionProvider(
			{ title: 'a', kind: 'a' },
			{ title: 'b', kind: 'b' },
			{ title: 'a.b', kind: 'a.b' }
		);

		disposables.add(modes.CodeActionProviderRegistry.register('fooLang', provider));

		{
			const { validActions: actions } = await getCodeActions(model, new Range(1, 1, 2, 1), { type: CodeActionTriggerType.Auto, filter: { include: new CodeActionKind('a') } }, CancellationToken.None);
			assert.equal(actions.length, 2);
			assert.strictEqual(actions[0].title, 'a');
			assert.strictEqual(actions[1].title, 'a.b');
		}

		{
			const { validActions: actions } = await getCodeActions(model, new Range(1, 1, 2, 1), { type: CodeActionTriggerType.Auto, filter: { include: new CodeActionKind('a.b') } }, CancellationToken.None);
			assert.equal(actions.length, 1);
			assert.strictEqual(actions[0].title, 'a.b');
		}

		{
			const { validActions: actions } = await getCodeActions(model, new Range(1, 1, 2, 1), { type: CodeActionTriggerType.Auto, filter: { include: new CodeActionKind('a.b.c') } }, CancellationToken.None);
			assert.equal(actions.length, 0);
		}
	});

	test('getCodeActions should forward requested scope to providers', async function () {
		const provider = new class implements modes.CodeActionProvider {
			provideCodeActions(_model: any, _range: Range, context: modes.CodeActionContext, _token: any): modes.CodeActionList {
				return {
					actions: [
						{ title: context.only || '', kind: context.only }
					],
					dispose: () => { }
				};
			}
		};

		disposables.add(modes.CodeActionProviderRegistry.register('fooLang', provider));

		const { validActions: actions } = await getCodeActions(model, new Range(1, 1, 2, 1), { type: CodeActionTriggerType.Auto, filter: { include: new CodeActionKind('a') } }, CancellationToken.None);
		assert.equal(actions.length, 1);
		assert.strictEqual(actions[0].title, 'a');
	});

	test('getCodeActions should not return source code action by default', async function () {
		const provider = staticCodeActionProvider(
			{ title: 'a', kind: CodeActionKind.Source.value },
			{ title: 'b', kind: 'b' }
		);

		disposables.add(modes.CodeActionProviderRegistry.register('fooLang', provider));

		{
			const { validActions: actions } = await getCodeActions(model, new Range(1, 1, 2, 1), { type: CodeActionTriggerType.Auto }, CancellationToken.None);
			assert.equal(actions.length, 1);
			assert.strictEqual(actions[0].title, 'b');
		}

		{
			const { validActions: actions } = await getCodeActions(model, new Range(1, 1, 2, 1), { type: CodeActionTriggerType.Auto, filter: { include: CodeActionKind.Source, includeSourceActions: true } }, CancellationToken.None);
			assert.equal(actions.length, 1);
			assert.strictEqual(actions[0].title, 'a');
		}
	});

	test('getCodeActions should support filtering out some requested source code actions #84602', async function () {
		const provider = staticCodeActionProvider(
			{ title: 'a', kind: CodeActionKind.Source.value },
			{ title: 'b', kind: CodeActionKind.Source.append('test').value },
			{ title: 'c', kind: 'c' }
		);

		disposables.add(modes.CodeActionProviderRegistry.register('fooLang', provider));

		{
			const { validActions: actions } = await getCodeActions(model, new Range(1, 1, 2, 1), {
				type: CodeActionTriggerType.Auto, filter: {
					include: CodeActionKind.Source.append('test'),
					excludes: [CodeActionKind.Source],
					includeSourceActions: true,
				}
			}, CancellationToken.None);
			assert.equal(actions.length, 1);
			assert.strictEqual(actions[0].title, 'b');
		}
	});

	test('getCodeActions should not invoke code action providers filtered out by providedCodeActionKinds', async function () {
		let wasInvoked = false;
		const provider = new class implements modes.CodeActionProvider {
			provideCodeActions(): modes.CodeActionList {
				wasInvoked = true;
				return { actions: [], dispose: () => { } };
			}

			providedCodeActionKinds = [CodeActionKind.Refactor.value];
		};

		disposables.add(modes.CodeActionProviderRegistry.register('fooLang', provider));

		const { validActions: actions } = await getCodeActions(model, new Range(1, 1, 2, 1), {
			type: CodeActionTriggerType.Auto,
			filter: {
				include: CodeActionKind.QuickFix
			}
		}, CancellationToken.None);
		assert.strictEqual(actions.length, 0);
		assert.strictEqual(wasInvoked, false);
	});
});

