// TODO https://hyperfetch.bettertyped.com/docs/Getting%20Started/Comparison/

import {
  action,
  Action,
  ActionParams,
  ActionPayload,
  atom,
  Atom,
  AtomCache,
  AtomMut,
  Ctx,
  CtxParams,
  Fn,
  throwReatomError,
  __count,
} from '@reatom/core'
import { __thenReatomed } from '@reatom/effects'
import { addOnUpdate, onUpdate, spyChange, __findCause } from '@reatom/hooks'
import { assign } from '@reatom/utils'

import { CACHE } from './cache'
export { withCache } from './withCache'
export { withStatusesAtom } from './withStatusesAtom'
export type {
  AsyncStatusesNeverPending,
  AsyncStatusesFirstPending,
  AsyncStatusesFulfilled,
  AsyncStatusesRejected,
  AsyncStatusesAnotherPending,
  AsyncStatusesPending,
  AsyncStatuses,
  AsyncStatusesAtom,
} from './withStatusesAtom'

export interface AsyncAction<Params extends any[] = any[], Resp = any>
  extends Action<Params, ControlledPromise<Resp>> {
  onFulfill: Action<[Resp], Resp>
  onReject: Action<[unknown], unknown>
  onSettle: Action<[], void>
  pendingAtom: Atom<number>
}

export interface AsyncCtx extends Ctx {
  controller: AbortController
}

export interface AsyncOptions<Params extends any[] = any[], Resp = any> {
  name?: string
  onEffect?: Fn<[Ctx, Params, ControlledPromise<Resp>]>
  onFulfill?: Fn<[Ctx, Resp]>
  onReject?: Fn<[Ctx, unknown]>
  onSettle?: Fn<[Ctx]>
}

export interface ControlledPromise<T = any> extends Promise<T> {
  controller: AbortController
}

export const isAbortError = (thing: any): thing is Error =>
  thing instanceof Error && thing.name === 'AbortError'

export const reatomAsync = <
  Params extends [AsyncCtx, ...any[]] = [AsyncCtx, ...any[]],
  Resp = any,
>(
  effect: Fn<Params, Promise<Resp>>,
  options: string | AsyncOptions<CtxParams<Params>, Resp> = {},
): AsyncAction<CtxParams<Params>, Resp> => {
  const {
    name = __count('async'),
    onEffect: onEffectHook,
    onFulfill: onFulfillHook,
    onReject: onRejectHook,
    onSettle: onSettleHook,
  } = typeof options === 'string'
    ? ({ name: options } as AsyncOptions<CtxParams<Params>, Resp>)
    : options

  const pendingAtom = atom(0, `${name}.pendingAtom`)

  const onEffect = action((...params) => {
    const ctx = params[0] as AsyncCtx
    const controller = (ctx.controller = new AbortController())
    controller.signal.throwIfAborted ??= () => {
      if (controller.signal.aborted) {
        let error = controller.signal.reason
        if (error instanceof Error === false) {
          error = new Error(controller.signal.reason)
          error.name = 'AbortError'
        }
        throw error
      }
    }
    assign(ctx.cause, { controller })

    const topController = __findCause(
      ctx.cause.cause,
      (cause: AtomCache & { controller?: AbortController }) => cause.controller,
    )
    if (topController) {
      const abort = () => controller.abort(topController.signal.reason)
      if (topController.signal.aborted) abort()
      else topController.signal.addEventListener('abort', abort)
    }

    pendingAtom(ctx, (s) => ++s)

    const promise: ControlledPromise = assign(
      ctx.schedule(() => {
        controller.signal.throwIfAborted()
        if (CACHE.has(promise)) return CACHE.get(promise)
        return effect(...(params as Params)).then(
          (value: any) => (controller.signal.throwIfAborted(), value),
        )
      }),
      { controller },
    )

    __thenReatomed(
      ctx,
      promise,
      (v) =>
        CACHE.has(promise) || (onFulfill(ctx, v), pendingAtom(ctx, (s) => --s)),
      (e) => (onReject(ctx, e), pendingAtom(ctx, (s) => --s)),
    )

    return promise
  }, name)

  const onFulfill = action<Resp>(`${name}.onFulfill`)
  const onReject = action<unknown>(`${name}.onReject`)
  const onSettle = action(`${name}._onSettle`)

  onUpdate(onFulfill, (ctx) => onSettle(ctx))
  onUpdate(onReject, (ctx) => onSettle(ctx))

  if (onEffectHook)
    // @ts-ignore
    onUpdate(onEffect, (ctx, promise, { state }) =>
      onEffectHook(ctx, state.at(-1)!.params as any, promise),
    )
  if (onFulfillHook) onUpdate(onFulfill, onFulfillHook)
  if (onRejectHook) onUpdate(onReject, onRejectHook)
  if (onSettleHook) onUpdate(onSettle, onSettleHook)

  return assign(onEffect, {
    onFulfill,
    onReject,
    onSettle,
    pendingAtom,
  })
}
reatomAsync.from = <Params extends any[], Resp = any>(
  effect: Fn<Params, Promise<Resp>>,
  options: string | AsyncOptions<Params, Resp> = {},
): AsyncAction<Params, Resp> =>
  // @ts-expect-error
  reatomAsync((ctx, ...a) => effect(...a), options)

export interface AsyncDataAtom<State = any> extends AtomMut<State> {
  reset: Action<[], void>
}

// TODO
// @ts-ignore
export const withDataAtom: {
  <
    T extends AsyncAction & {
      dataAtom?: AsyncDataAtom<ActionPayload<T['onFulfill']>>
    },
  >(): Fn<
    [T],
    T & { dataAtom: AtomMut<undefined | ActionPayload<T['onFulfill']>> }
  >
  <
    T extends AsyncAction & {
      dataAtom?: AsyncDataAtom<ActionPayload<T['onFulfill']>>
    },
  >(
    initState: ActionPayload<T['onFulfill']>,
  ): Fn<[T], T & { dataAtom: AsyncDataAtom<ActionPayload<T['onFulfill']>> }>
  <
    T extends AsyncAction & {
      dataAtom?: AsyncDataAtom<State | ActionPayload<T['onFulfill']>>
    },
    State,
  >(
    initState: State,
  ): Fn<
    [T],
    T & { dataAtom: AsyncDataAtom<State | ActionPayload<T['onFulfill']>> }
  >
  <
    T extends AsyncAction & {
      dataAtom?: AsyncDataAtom<ActionPayload<T['onFulfill']>>
    },
  >(
    initState: ActionPayload<T['onFulfill']>,
    map?: Fn<
      [
        ctx: Ctx,
        payload: ActionPayload<T['onFulfill']>,
        state: ActionPayload<T['onFulfill']>,
      ],
      ActionPayload<T['onFulfill']>
    >,
  ): Fn<[T], T & { dataAtom: AsyncDataAtom<ActionPayload<T['onFulfill']>> }>
  <
    T extends AsyncAction & {
      dataAtom?: AsyncDataAtom<State>
    },
    State,
  >(
    initState: State,
    map?: Fn<
      [ctx: Ctx, payload: ActionPayload<T['onFulfill']>, state: State],
      State
    >,
  ): Fn<[T], T & { dataAtom: AsyncDataAtom<State> }>
} =
  (initState: any, map?: Fn) =>
  // @ts-ignore
  (anAsync) => {
    if (!anAsync.dataAtom) {
      const dataAtom = (anAsync.dataAtom = atom(
        initState,
        `${anAsync.__reatom.name}.dataAtom`,
      )) as AsyncDataAtom
      dataAtom.reset = action(
        (ctx) => void dataAtom(ctx, initState),
        `${anAsync.__reatom.name}.dataAtom.reset`,
      )
      onUpdate(anAsync.onFulfill, (ctx, payload) =>
        dataAtom(ctx, (state: any) =>
          map ? map(ctx, payload, state) : payload,
        ),
      )
    }

    return anAsync
  }

export const withErrorAtom =
  <
    T extends AsyncAction & {
      errorAtom?: Atom<undefined | Err> & { reset: Action }
    },
    Err = Error,
  >(
    parseError: Fn<[Ctx, unknown], Err> = (ctx, e) =>
      (e instanceof Error ? e : new Error(String(e))) as Err,
    {
      resetTrigger,
    }: {
      resetTrigger:
        | null
        | 'onEffect'
        | 'onFulfill'
        | ('dataAtom' extends keyof T ? 'dataAtom' : null)
    } = {
      resetTrigger: 'onEffect',
    },
  ): Fn<[T], T & { errorAtom: Atom<undefined | Err> & { reset: Action } }> =>
  (anAsync) => {
    if (!anAsync.errorAtom) {
      const errorAtomName = `${anAsync.__reatom.name}.errorAtom`
      const errorAtom = (anAsync.errorAtom = assign(
        atom<undefined | Err>(undefined, errorAtomName),
        {
          reset: action((ctx) => {
            errorAtom(ctx, undefined)
          }, `${errorAtomName}.reset`),
        },
      ))
      addOnUpdate(anAsync.onReject, (ctx, { state }) =>
        errorAtom(ctx, parseError(ctx, state.at(-1)!.payload)),
      )
      if (resetTrigger) {
        addOnUpdate(
          // @ts-expect-error
          anAsync[resetTrigger] ?? anAsync,
          (ctx) => ctx.get(errorAtom) !== undefined && errorAtom.reset(ctx),
        )
      }
    }

    return anAsync as T & { errorAtom: Atom<undefined | Err> }
  }

export const withAbort =
  <
    T extends AsyncAction & {
      abort?: Action<[reason?: string], void>
      onAbort?: Action<[Error], Error>
      abortControllerAtom?: Atom<AbortController | null>
    },
  >({
    strategy = 'last-in-win',
  }: { strategy?: 'none' | 'last-in-win' } = {}): Fn<
    [T],
    T & {
      abort: Action<[reason?: string], void>
      onAbort: Action<[Error], Error>
      abortControllerAtom: Atom<AbortController | null>
    }
  > =>
  (anAsync) => {
    if (!anAsync.abort) {
      const abortControllerAtom = (anAsync.abortControllerAtom = atom(
        (ctx, state: null | AbortController = null) => {
          spyChange(ctx, anAsync, (call) => {
            if (strategy === 'last-in-win' && state) {
              const error = new Error('concurrent request')
              error.name = 'AbortError'
              const controller = state
              ctx.schedule(() => controller.abort(error))
            }

            state = call.payload.controller

            const { signal } = state
            signal.addEventListener('abort', () => {
              let error = signal.reason
              if (error instanceof Error === false) {
                error = new Error(signal.reason)
                error.name = 'AbortError'
              }
              anAsync.onAbort!(ctx, error)
            })
          })

          spyChange(ctx, anAsync.onSettle, () => (state = null))

          return state
        },
        `${anAsync.__reatom.name}._abortControllerAtom`,
      ))
      addOnUpdate(anAsync, (ctx) => void ctx.get(abortControllerAtom))

      anAsync.abort = action((ctx, reason?: string) => {
        const controller = ctx.get(abortControllerAtom)
        if (controller) ctx.schedule(() => controller.abort(reason))
      }, `${anAsync.__reatom.name}.abort`)
      anAsync.onAbort = action<Error>(`${anAsync.__reatom.name}.onAbort`)
    }

    return anAsync as T & {
      abort: Action<[reason?: string], void>
      onAbort: Action<[Error], Error>
      abortControllerAtom: Atom<AbortController | null>
    }
  }

export const withRetry =
  <
    T extends AsyncAction & {
      paramsAtom?: Atom<Params | ActionParams<T>>
      retry?: Action<[], ActionPayload<T>>
      retriesAtom?: Atom<number>
    },
    Params extends ActionParams<T> | undefined = undefined,
  >({
    fallbackParams,
    onReject,
  }: {
    fallbackParams?: Params
    onReject?: Fn<[ctx: Ctx, error: unknown, retries: number], void | number>
  } = {}): Fn<
    [T],
    T & {
      paramsAtom: Atom<undefined | ActionParams<T>>
      retry: Action<[], ActionPayload<T>>
      retriesAtom: Atom<number>
    }
  > =>
  (anAsync) => {
    if (!anAsync.paramsAtom) {
      const paramsAtom = (anAsync.paramsAtom = atom(
        fallbackParams as Params,
        `${anAsync.__reatom.name}.paramsAtom`,
      ))
      addOnUpdate(anAsync, (ctx, patch) =>
        paramsAtom(ctx, patch.state.at(-1)?.params as Params),
      )

      anAsync.retry = action((ctx) => {
        const params = ctx.get(anAsync.paramsAtom!)
        throwReatomError(!params, 'no cached params')
        return anAsync(ctx, ...params!) as ActionPayload<T>
      }, `${anAsync.__reatom.name}.retry`)

      const retriesAtom = (anAsync.retriesAtom = atom(
        0,
        `${anAsync.__reatom.name}.retriesAtom`,
      ))
      addOnUpdate(anAsync.retry, (ctx) => retriesAtom(ctx, (s) => ++s))
      addOnUpdate(anAsync.onFulfill, (ctx) => retriesAtom(ctx, 0))

      if (onReject) {
        addOnUpdate(anAsync.onReject, (ctx, { state }) => {
          if (state.length === 0) return

          const timeout =
            onReject(ctx, state.at(-1)!.payload, ctx.get(retriesAtom)) ?? -1

          if (timeout < 0) return

          if (timeout === 0) {
            anAsync.retry!(ctx)
          } else {
            const rejectCache = anAsync.onReject.__reatom.patch
            setTimeout(
              () =>
                ctx.get(
                  (r) =>
                    rejectCache === r(anAsync.onReject.__reatom) &&
                    anAsync.retry!(ctx),
                ),
              timeout,
            )
          }
        })
      }
    }

    return anAsync as T & {
      paramsAtom: Atom<undefined | ActionParams<T>>
      retry: Action<[], ActionPayload<T>>
      retriesAtom: Atom<number>
    }
  }

/** @deprecated use `withRetry` instead */
export const withRetryAction = withRetry
