import { PathFinderStepper, StepperConfig } from "./PathFinderStepper";
import { PathFinder, SteppingPathFinder } from "./types";

type WrapFactory<T> = (pf: PathFinder<T>) => PathFinder<T>;

/**
 * PathFinderBuilder - fluent builder for composing PathFinder transformers.
 *
 * Usage:
 *   const finder = PathFinderBuilder.create(corePathFinder)
 *     .wrap((pf) => new SomeTransformer(pf, deps))
 *     .wrap((pf) => new AnotherTransformer(pf, deps))
 *     .build();
 */
export class PathFinderBuilder<T> {
  private wrappers: WrapFactory<T>[] = [];

  private constructor(private core: PathFinder<T>) {}

  static create<T>(core: PathFinder<T>): PathFinderBuilder<T> {
    return new PathFinderBuilder(core);
  }

  wrap(factory: WrapFactory<T>): this {
    this.wrappers.push(factory);
    return this;
  }

  build(): PathFinder<T> {
    return this.wrappers.reduce(
      (pf, wrapper) => wrapper(pf),
      this.core as PathFinder<T>,
    );
  }

  /**
   * Build and wrap with PathFinderStepper for step-by-step traversal.
   */
  buildWithStepper(config: StepperConfig<T>): SteppingPathFinder<T> {
    return new PathFinderStepper(this.build(), config);
  }
}
