'use strict';

class DependencyNotConfiguredError extends Error {
  constructor(dependency) {
    super(`${dependency}-not-configured`);
    this.code = 'dependency-not-configured';
    this.dependency = dependency;
  }
}

class VinDecoderAdapter {
  async decode() { throw new DependencyNotConfiguredError('vin-decoder'); }
}

class PartImageRecognitionAdapter {
  async identify() { throw new DependencyNotConfiguredError('part-image-recognition'); }
}

class RoadsideDispatchAdapter {
  async requestAssistance() { throw new DependencyNotConfiguredError('roadside-dispatch'); }
}

class TowingAdapter {
  async requestTow() { throw new DependencyNotConfiguredError('towing-provider'); }
}

module.exports = {
  DependencyNotConfiguredError,
  VinDecoderAdapter,
  PartImageRecognitionAdapter,
  RoadsideDispatchAdapter,
  TowingAdapter
};
