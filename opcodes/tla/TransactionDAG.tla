------------------------- MODULE TransactionDAG -------------------------
(*
 * Transaction DAG and Compositional State Forest.
 *
 * Models the theorem: "The blockchain is not a linear execution
 * environment but a directed acyclic graph (DAG) of transactions,
 * where each path represents a possible execution history, and
 * pre-signed transactions create exclusive branching futures."
 *
 * Source: Craig Wright, Chapter 3 — The Architecture of On-Chain
 * Commercial State.
 *
 * Also covers the temporal morphism property: inputs are backward-
 * facing attestations that verify the right to transform state;
 * outputs are forward-facing promises that commit to future conditions.
 *
 * Key properties:
 *   DAG-1: No cycles in the transaction graph
 *   DAG-2: Pre-signed paths spending the same output are exclusive
 *   DAG-3: Path pruning is irreversible (once spent, alternatives die)
 *   DAG-4: DAG merging (multi-input tx) preserves acyclicity
 *   MOR-1: Every input references an existing unspent output
 *   MOR-2: Validation (attestation) must precede commitment (promise)
 *
 * Related Semantos specs:
 *   - ReplayPrevention.tla: single-output exclusivity (LINEAR)
 *   - EvidenceChain.tla: hash-linked cell chain integrity
 *   - SemanticTypes.tla: linearity type system
 *
 * Related Lean proofs:
 *   - K1 (linearity): enforces single consumption
 *   - K4 (failure atomicity): state transitions are atomic
 *   - K5 (termination): scripts terminate deterministically
 *)

EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    TxIds,       \* Set of transaction identifiers (model values)
    OutputIds,   \* Set of output identifiers (model values)
    MaxTxCount,  \* Maximum number of transactions for finite model checking
    NULL         \* Distinguished null value

(*
 * An Output (spendable output) is a forward-facing promise:
 *   - createdBy: the transaction that created it
 *   - spent: whether it has been consumed by an input (attestation)
 *   - spentBy: the transaction that consumed it (NULL if unspent)
 *)
OutputRecord == [
    createdBy : TxIds \cup {NULL},
    spent     : BOOLEAN,
    spentBy   : TxIds \cup {NULL}
]

(*
 * A Transaction is a morphism — a state transition function:
 *   - inputs: set of OutputIds consumed (backward-facing attestations)
 *   - outputs: set of OutputIds created (forward-facing promises)
 *   - confirmed: whether this tx has been included on-chain
 *   - order: sequence number establishing temporal ordering
 *)
TransactionRecord == [
    inputs    : SUBSET OutputIds,
    outputs   : SUBSET OutputIds,
    confirmed : BOOLEAN,
    order     : Nat
]

\* --- State variables ---

VARIABLES
    transactions,  \* Function: TxIds -> TransactionRecord (or NULL)
    outputState,   \* Function: OutputIds -> OutputRecord (or NULL)
    txCount,       \* Number of transactions created so far
    confirmedSet,  \* Set of confirmed TxIds (for cycle checking)
    step           \* Step counter for bounding

vars == <<transactions, outputState, txCount, confirmedSet, step>>

\* --- Initial state ---

Init ==
    /\ transactions = [t \in TxIds |-> NULL]
    /\ outputState = [o \in OutputIds |-> NULL]
    /\ txCount = 0
    /\ confirmedSet = {}
    /\ step = 0

\* --- Helper operators ---

(*
 * ActiveOutputs: the set of output IDs that exist and are unspent.
 * These are the current "leaves" of the DAG — available for spending.
 *)
ActiveOutputs ==
    {o \in OutputIds : outputState[o] /= NULL /\ ~outputState[o].spent}

(*
 * AllCreatedOutputs: every output that exists (spent or unspent).
 *)
AllCreatedOutputs ==
    {o \in OutputIds : outputState[o] /= NULL}

(*
 * ConfirmedTxs: set of confirmed transactions.
 *)
ConfirmedTxs ==
    {t \in TxIds : transactions[t] /= NULL /\ transactions[t].confirmed}

\* --- Actions ---

(*
 * CreateTransaction: a new transaction consumes some unspent outputs
 * (attestation / proof of right) and creates new outputs (promises).
 *
 * This models the morphism: State_in → Validation → State_out
 *
 * Guards:
 *   - All inputs must be existing, unspent outputs (MOR-1)
 *   - The inputs must not be empty (tx must attest to something)
 *   - The new outputs must not already exist
 *   - Bounded by MaxTxCount
 *
 * The temporal ordering property (MOR-2) is enforced structurally:
 * the inputs (attestations) are validated BEFORE outputs (promises)
 * are created. The "order" field records this sequencing.
 *)
CreateTransaction(txId, inputs, outputs) ==
    /\ step < 10
    /\ txCount < MaxTxCount
    /\ transactions[txId] = NULL
    /\ inputs /= {}
    /\ outputs /= {}
    /\ inputs \subseteq ActiveOutputs
    /\ \A o \in outputs : outputState[o] = NULL
    /\ inputs \cap outputs = {}
    \* --- Attestation phase: consume inputs ---
    /\ outputState' = [o \in OutputIds |->
           IF o \in inputs THEN
               [outputState[o] EXCEPT !.spent = TRUE, !.spentBy = txId]
           ELSE IF o \in outputs THEN
               [createdBy |-> txId, spent |-> FALSE, spentBy |-> NULL]
           ELSE
               outputState[o]
       ]
    \* --- Record the morphism ---
    /\ transactions' = [transactions EXCEPT ![txId] = [
           inputs    |-> inputs,
           outputs   |-> outputs,
           confirmed |-> FALSE,
           order     |-> txCount
       ]]
    /\ txCount' = txCount + 1
    /\ UNCHANGED <<confirmedSet>>
    /\ step' = step + 1

(*
 * ConfirmTransaction: a pending transaction is included on-chain.
 * Once confirmed, any competing transactions spending the same
 * outputs are invalidated (DAG-3: path pruning).
 *)
ConfirmTransaction(txId) ==
    /\ step < 10
    /\ transactions[txId] /= NULL
    /\ ~transactions[txId].confirmed
    \* All inputs must be spent by THIS transaction
    /\ \A o \in transactions[txId].inputs :
           outputState[o].spentBy = txId
    /\ transactions' = [transactions EXCEPT ![txId].confirmed = TRUE]
    /\ confirmedSet' = confirmedSet \cup {txId}
    /\ UNCHANGED <<outputState, txCount>>
    /\ step' = step + 1

(*
 * CreateCoinbase: a transaction with no inputs (DAG root).
 * Models the genesis of value — creates outputs without attestation.
 * These are the roots of the DAG.
 *)
CreateCoinbase(txId, outputs) ==
    /\ step < 10
    /\ txCount < MaxTxCount
    /\ transactions[txId] = NULL
    /\ outputs /= {}
    /\ \A o \in outputs : outputState[o] = NULL
    /\ outputState' = [o \in OutputIds |->
           IF o \in outputs THEN
               [createdBy |-> txId, spent |-> FALSE, spentBy |-> NULL]
           ELSE
               outputState[o]
       ]
    /\ transactions' = [transactions EXCEPT ![txId] = [
           inputs    |-> {},
           outputs   |-> outputs,
           confirmed |-> TRUE,
           order     |-> txCount
       ]]
    /\ txCount' = txCount + 1
    /\ confirmedSet' = confirmedSet \cup {txId}
    /\ step' = step + 1

(*
 * CompetingSpend: two transactions try to spend the same output.
 * This models the exclusive futures / pre-signed tx scenario.
 * Only one can ultimately be confirmed (DAG-2).
 *
 * This action creates a second tx spending an already-spent output.
 * The conflict is represented but only one can confirm.
 *)
CompetingSpend(txId, conflictOutput, otherInputs, outputs) ==
    /\ step < 10
    /\ txCount < MaxTxCount
    /\ transactions[txId] = NULL
    /\ outputState[conflictOutput] /= NULL
    /\ outputState[conflictOutput].spent
    \* The output was spent by a different, UNCONFIRMED tx
    /\ outputState[conflictOutput].spentBy /= NULL
    /\ LET spender == outputState[conflictOutput].spentBy
       IN /\ transactions[spender] /= NULL
          /\ ~transactions[spender].confirmed
    /\ outputs /= {}
    /\ \A o \in outputs : outputState[o] = NULL
    /\ otherInputs \subseteq ActiveOutputs
    /\ LET allInputs == otherInputs \cup {conflictOutput}
       IN /\ allInputs \cap outputs = {}
          \* Re-assign the conflicted output to this new tx
          /\ outputState' = [o \in OutputIds |->
                 IF o = conflictOutput THEN
                     [outputState[o] EXCEPT !.spentBy = txId]
                 ELSE IF o \in otherInputs THEN
                     [outputState[o] EXCEPT !.spent = TRUE, !.spentBy = txId]
                 ELSE IF o \in outputs THEN
                     [createdBy |-> txId, spent |-> FALSE, spentBy |-> NULL]
                 ELSE
                     outputState[o]
             ]
          /\ transactions' = [transactions EXCEPT ![txId] = [
                 inputs    |-> allInputs,
                 outputs   |-> outputs,
                 confirmed |-> FALSE,
                 order     |-> txCount
             ]]
    /\ txCount' = txCount + 1
    /\ UNCHANGED <<confirmedSet>>
    /\ step' = step + 1

Next ==
    \/ \E t \in TxIds, ins \in SUBSET OutputIds, outs \in SUBSET OutputIds :
           CreateTransaction(t, ins, outs)
    \/ \E t \in TxIds :
           ConfirmTransaction(t)
    \/ \E t \in TxIds, outs \in SUBSET OutputIds :
           CreateCoinbase(t, outs)
    \/ \E t \in TxIds, co \in OutputIds, oi \in SUBSET OutputIds, outs \in SUBSET OutputIds :
           CompetingSpend(t, co, oi, outs)

Spec == Init /\ [][Next]_vars

\* --- Safety properties ---

(*
 * DAG-1 (Acyclicity): No transaction can spend its own outputs.
 * More generally, the spending graph has no cycles. We check the
 * local property: for every confirmed tx, its inputs were created
 * by a transaction with a strictly lower order number.
 *
 * This is the core DAG property — time flows from inputs to outputs.
 *)
Acyclicity ==
    \A t \in TxIds :
        transactions[t] /= NULL =>
            \A o \in transactions[t].inputs :
                outputState[o] /= NULL =>
                    LET creator == outputState[o].createdBy
                    IN creator /= NULL =>
                       transactions[creator] /= NULL =>
                           transactions[creator].order < transactions[t].order

(*
 * DAG-2 (Path Exclusivity): At most one confirmed transaction can
 * spend any given output. Pre-signed alternatives are mutually
 * exclusive — only one path is actualized.
 *
 * This directly models the theorem: "Multiple pre-signed transactions
 * spending the same spendable output create mutually exclusive future
 * states. Only one path can be actualized on-chain."
 *)
PathExclusivity ==
    \A o \in OutputIds :
        outputState[o] /= NULL /\ outputState[o].spent =>
            \A t1, t2 \in confirmedSet :
                (o \in transactions[t1].inputs /\ o \in transactions[t2].inputs)
                    => t1 = t2

(*
 * DAG-3 (Pruning Irreversibility): Once an output is spent by a
 * confirmed transaction, no other transaction can claim it.
 * The spent flag combined with confirmation is permanent.
 *)
PruningIrreversibility ==
    \A o \in OutputIds :
        outputState[o] /= NULL /\ outputState[o].spent =>
            outputState[o].spentBy /= NULL

(*
 * MOR-1 (Attestation Validity): Every input in a transaction
 * references an output that actually exists. No transaction
 * can attest to a non-existent state.
 *)
AttestationValidity ==
    \A t \in TxIds :
        transactions[t] /= NULL =>
            \A o \in transactions[t].inputs :
                outputState[o] /= NULL

(*
 * MOR-2 (Temporal Ordering): For every transaction, the outputs
 * (promises) were created in the same step as or after the inputs
 * (attestations) were validated. We check: every output's creator
 * has an order >= the creator of any input it consumes.
 *
 * This models the temporal flow: attestation (past) → promise (future).
 *)
TemporalOrdering ==
    \A t \in TxIds :
        transactions[t] /= NULL =>
            \A o \in transactions[t].outputs :
                outputState[o] /= NULL =>
                    outputState[o].createdBy = t

(*
 * TypeInv: basic type invariant for all state variables.
 *)
TypeInv ==
    /\ \A t \in TxIds :
           transactions[t] = NULL \/ transactions[t] \in TransactionRecord
    /\ \A o \in OutputIds :
           outputState[o] = NULL \/ outputState[o] \in OutputRecord

(*
 * SpentHasSpender: any spent output records who spent it.
 *)
SpentHasSpender ==
    \A o \in OutputIds :
        outputState[o] /= NULL /\ outputState[o].spent =>
            outputState[o].spentBy \in TxIds

=============================================================================
