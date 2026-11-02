import { userRepository } from "@/repositories/user.repository";

export const devIdentityService = {
  list() {
    return userRepository.listDevIdentities();
  },
};
