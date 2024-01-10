import { mergePatch } from '../mergePatch';
import {
  InferDiscriminatedEntity,
  InferDiscriminatedEntityWithId,
  InferEntity,
  TypedArray,
  ModelAny,
} from './model';
import z from 'zod';

export type CreateMutation<RM extends ModelAny> = {
  operation: 'Create';
  name: RM['name'];
  entity: z.infer<RM['schema']>;
};
export type UpdateMutation<RM extends ModelAny> = {
  operation: 'Update';
  name: RM['name'];
  //this is expected to be a rfc7396 merge patch: https://datatracker.ietf.org/doc/html/rfc7396
  //which is hopefully simpler but more limited
  //may support the other patch format in the future
  //I tried typing this as a deep partial of the model schema but its not really worth it
  //better to just treat it as any and let the merge logic deal with it
  entity: any;
};

export type DeleteMutation<RM extends ModelAny> = {
  operation: 'Delete';
  name: RM['name'];
  entity: { id: string };
};

type InferMutation<RM extends ModelAny> = RM extends any
  ? CreateMutation<RM> | UpdateMutation<RM> | DeleteMutation<RM>
  : never;

export type PoolFactory<S extends PoolSchemaAny> = {
  create: (
    root: InferEntity<S['rootModel']>,
    entities: InferPoolEntity<S>[],
  ) => Pool<S, InferEntity<S['rootModel']>>;
  empty: () => Pool<S, undefined>;
};

export type Pool<
  S extends PoolSchemaAny,
  RE extends InferPoolEntity<S>['entity'] | undefined,
> = {
  root: RE;
  parse: DiscriminatedEntityParser<InferPoolEntity<S>>;
  //a transaction consists of a collection of mutations
  //todo make this a pure function
  apply: (transaction: InferPoolMutation<S>[]) => void;
  //probably should be an array
  //probably wouldn't expose this at all
  state: PoolState<S>;
};

export type DiscriminatedEntityParser<M extends any> = (
  entity: unknown,
) => z.SafeParseReturnType<unknown, M>;

export function discriminatedModelParser<S extends PoolSchemaAny>({
  rootModel,
  models,
}: S): DiscriminatedEntityParser<InferPoolEntity<S>> {
  //if the name descriminator was provided as a zod literal in the model, then it would be easier to construct the discriminated entity validator
  // but thought i would save a little verbosity in the API
  const rootDiscriminatedModel = z.object({
    name: z.literal(rootModel.name),
    entity: rootModel.schema,
  });

  const discriminatedModels = models.map((model) =>
    z.object({
      name: z.literal(model.name),
      entity: model.schema,
    }),
  );

  const discriminatedEntityValidator = z.discriminatedUnion('name', [
    rootDiscriminatedModel,
    ...discriminatedModels,
  ]);

  //also means we need to recover the output type manually with this
  return discriminatedEntityValidator.safeParse as DiscriminatedEntityParser<
    InferPoolEntity<S>
  >;
}

export type PoolSchema<RM extends ModelAny, MA extends ModelAny> = {
  rootModel: RM;
  models: MA[];

  //virtual fields to store types so that we don't have to keep recaculating them
  readonly _model: MA;
  readonly _entity: InferDiscriminatedEntity<MA>;
  readonly _mutation: InferMutation<MA>;
  readonly _entityName: MA['name'];
  readonly _entityWithId: InferDiscriminatedEntityWithId<MA>; //gross, shouldn't need this
};
export type PoolSchemaAny = PoolSchema<ModelAny, ModelAny>;
export type InferPoolModel<S extends PoolSchemaAny> = S['_model'];
export type InferPoolEntity<S extends PoolSchemaAny> = S['_entity'];
export type InferPoolEntityWithId<S extends PoolSchemaAny> = S['_entityWithId'];
export type InferPoolMutation<S extends PoolSchemaAny> = S['_mutation'];
export type InferPoolEntityName<S extends PoolSchemaAny> = S['_entityName'];
export type InferPoolRootEntity<S extends PoolSchemaAny> = InferEntity<
  S['rootModel']
>;

export function poolSchema<
  RM extends ModelAny,
  MA extends TypedArray<ModelAny>,
>(rootModel: RM, models: MA): PoolSchema<RM, RM | MA[number]> {
  return {
    rootModel,
    models,
    _entity: null as any,
    _entityName: null as any,
    _mutation: null as any,
    _model: null as any,
    _entityWithId: null as any,
  };
}

export function hasId(
  object: Record<string, any>,
): object is { id: string; [p: string]: any } {
  return 'id' in object;
}

//i would like to be more immutable / pure
//the pool can't be but maybe can get something in between
//this function annoys me
//i keep having to use lots of second order types in the body
//should i make this a class
export interface PoolState<S extends PoolSchemaAny> {
  get(
    name: InferPoolEntityName<S>,
    id: string,
  ): InferPoolEntityWithId<S> | undefined;
  set(discriminatedEntity: InferPoolEntityWithId<S>): void;
  delete(name: InferPoolEntityName<S>, id: string): void;
  snapshot(): InferPoolEntity<S>[];
}

export function discriminatedEntityId(name: string, id: string) {
  return `${name}/${id}`;
}
