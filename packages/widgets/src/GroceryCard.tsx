import type { App } from "@modelcontextprotocol/ext-apps";
import type { GroceryListData } from "@yamp/contract";
import {
	createGroceryBridgeAdapter,
	type GroceryBridge,
	GroceryList,
	grocerySnapshotFromBridge,
	resolveGroceryCapabilities,
	resolveHydratedGroceryCapabilities,
} from "@yamp/ui";
import * as React from "react";

export function GroceryCard({
	app,
	data,
}: {
	app: App;
	data: GroceryListData;
}) {
	const [initial] = React.useState(data);
	const [current, setCurrent] = React.useState(initial);
	const bridge = React.useState(() => app as unknown as GroceryBridge)[0];
	const host = React.useState(() => app.getHostCapabilities())[0];
	const hasServerTools = host?.serverTools != null;
	const hasModelContext = host?.updateModelContext != null;
	const eligible = resolveGroceryCapabilities({
		contractVersion: initial.contract_version,
		serverTools: hasServerTools,
		updateModelContext: hasModelContext,
		message: host?.message != null,
		hydrated: false,
	});
	const [hydrated, setHydrated] = React.useState(false);
	const [bootFailed, setBootFailed] = React.useState(false);

	React.useEffect(() => {
		if (!eligible.contractSupported || !hasServerTools || !hasModelContext)
			return;
		let cancelled = false;
		void (async () => {
			try {
				const result = await bridge.callServerTool({
					name: "read_grocery_snapshot",
					arguments: {},
				});
				const snapshot = grocerySnapshotFromBridge(result);
				if (!cancelled && snapshot) {
					setCurrent(snapshot);
					setHydrated(true);
				} else if (!cancelled) setBootFailed(true);
			} catch {
				if (!cancelled) setBootFailed(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [bridge, eligible.contractSupported, hasServerTools, hasModelContext]);

	const capabilities = resolveHydratedGroceryCapabilities({
		currentContractVersion: current.contract_version,
		serverTools: host?.serverTools != null,
		updateModelContext: host?.updateModelContext != null,
		message: host?.message != null,
		hydrated: hydrated && !bootFailed,
	});
	const { mode, contractSupported } = capabilities;
	const adapter = React.useMemo(
		() => createGroceryBridgeAdapter(bridge, { mode, contractSupported }),
		[bridge, mode, contractSupported],
	);
	return (
		<div
			data-widget="grocery-list"
			data-testid="grocery-card"
			data-hydrated={hydrated || undefined}
		>
			{bootFailed ? (
				<p className="muted-line" role="status">
					Showing the saved list read-only; current state could not be
					refreshed.
				</p>
			) : null}
			<GroceryList data={current} adapter={adapter} onDataChange={setCurrent} />
		</div>
	);
}
